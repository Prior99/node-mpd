var Socket = require('net').Socket;
var EventEmitter = require("events").EventEmitter;
var Util = require("util");

if(!String.prototype.trim) {
	(function() {
		// Make sure we trim BOM and NBSP
		var rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;
		String.prototype.trim = function() {
		return this.replace(rtrim, '');
	};
	})();
}

var MPD = function(obj) {
	this.port = obj.port ? obj.port : 6600;
	this.host = obj.host ? obj.host : "localhost";
	this._requests = [];
	this.status = {};
	this.server = {};
};

Util.inherits(MPD, EventEmitter);

/*
 * Top Level Methods
 */

MPD.prototype.play = function() {
	this._sendCommand("play", this._checkReturn.bind(this));
};

MPD.prototype.pause = function() {
	this._sendCommand("pause", this._checkReturn.bind(this));
};

MPD.prototype.next = function() {
	this._sendCommand("next", this._checkReturn.bind(this));
};

MPD.prototype.prev = function() {
	this._sendCommand("prev", this._checkReturn.bind(this));
};

MPD.prototype.toggle = function() {
	this._sendCommand("toggle", this._checkReturn.bind(this));
};

MPD.prototype.update = function() {
	this._sendCommand("update", this._checkReturn.bind(this));
};

MPD.prototype.updateStatus = function(callback) {
	this._sendCommand("status", function(message) {
		var array = message.split("\n");
		for(var i in array) {
			var keyValue = array[i].split(":");
			if(keyValue.length < 2) {
				if(array[i] !== "OK") {
					throw new Error("Unknown response while fetching status.");
				}
				else {
					continue;
				}
			}
			var key = keyValue[0];
			var value = keyValue[1].trim();
			switch(key) {
				case "volume":
					this.status.volume = parseFloat(value.replace("%", "")) / 100;
					break;
				case "repeat":
					this.status.repeat = (value === "1");
					break;
				case "single":
					this.status.single = (value === "1");
					break;
				case "consume":
					this.status.consume = (value === "1");
					break;
				case "playlistlength":
					this.status.playlistlength = parseInt(value);
					break;
				case "state":
					this.status.state = value;
					break;
				case "song":
					this.status.song = parseInt(value);
					break;
				case "time":
					this.status.time = {
						elapsed : parseInt(keyValue[1]),
						length : parseInt(keyValue[2])
					};
					break;
				case "bitrate":
					this.status.bitrate = parseInt(value);
					break;
			}
		}
		if(callback) {
			callback(this.status, this.server);
		}
	}.bind(this));
};

MPD.prototype.listall = function(callback) {
	this._sendCommand("listall", function(message) {
		message = message.replace("file: ", "");
		var songs = message.split("\n");
		this.songs = [];
		for(var i = 0; i < songs.length - 1; i++) {
			this.songs.push(songs[i]);
		}
		console.log("callback:", callback);
		if(callback) {
			callback(this.songs);
		}
	}.bind(this));
};

MPD.prototype.add = function(name, callback) {
	this._sendCommand("add", name, function(r) {
		this._checkReturn(r);
		callback();
	}.bind(this));
};

/*
 * Connect and disconnect
 */

MPD.prototype.connect = function() {
	this.client = new Socket();
	this.client.setEncoding('utf8');
	this._activeListener = this._initialGreeting.bind(this);
	this.client.connect(this.port, this.host, function() {
		this.client.on('data', this._onData.bind(this));
	}.bind(this));
};

MPD.prototype.disconnect = function() {
	this.client.destroy();
};

/*
 * Message handling
 */

MPD.prototype._initialGreeting = function(message) {
	var m;
	if(m = message.match(/OK\s(.*?)\s((:?[0-9]|\.))/)) {
		this.server.name = m[1];
		this.server.version = m[2];
	}
	else {
		throw new Error("Unknown values while receiving initial greeting");
	}
	//this._enterIdle();
	this.updateStatus(this._initialStatus.bind(this));
};

MPD.prototype._initialStatus = function() {
	this.emit('ready', this.status, this.server);
};

MPD.prototype._onMessage = function(message) {
	if(!message.match(/changed:\s*(.*?)\s+OK/)) {
		throw new Error("Received unknown message during idle: " + message);
	}
	this._enterIdle();
	this.updateStatus(function(status) {
		this.emit('update', status);
	}.bind(this));
};


MPD.prototype._onData = function(message) {
	message = message.trim();
	//console.log("RECV: " + message);
	if(this.idling) {
		this._onMessage(message);
	}
	else {
		//console.log("onData response for: \"" + message + "\"");
		this._handleResponse(message);
	}
};

MPD.prototype._checkReturn = function(msg) {
	if(msg !== "OK") {
		throw new Error("Non okay return status: \"" + msg + "\"");
	}
};

/*
 * Idling
 */

MPD.prototype._enterIdle = function(callback) {
	this.idling = true;
	this._write("idle");
};

MPD.prototype._leaveIdle = function(callback) {
	this.idling = false;
	this.client.once("data", function(message) {
		this._checkReturn(message.trim());
		callback();
	}.bind(this));
	this._write("noidle");
};

MPD.prototype._checkIdle = function() {
	if(!this._activeListener && this._requests.length == 0 && !this.idling) {
		//console.log("No more requests, entering idle.");
		this._enterIdle();
	}
};

/*
 * Sending messages
 */

MPD.prototype._checkOutgoing = function() {
	var request;
	if(this._activeListener) {
		//console.log("No deque as active listener.");
		return;
	}
	if(request = this._requests.shift()) {
		//console.log("Pending deque, leaving idle.");
		this._leaveIdle(function() {
			//console.log("Dequed.");
			this._activeListener = request.callback;
			this._write(request.message);
		}.bind(this));
	}
};

MPD.prototype._sendCommand = function() {
	var cmd = "", args = "", callback;
	if(arguments.length == 0) {
		return;
	}
	if(arguments.length >= 1) {
		cmd = arguments[0];
	}
	if(arguments.length >= 2) {
		callback = arguments[arguments.length - 1];
	}
	for(var i = 1; i < arguments.length -1; i++) {
		args += "\"" + arguments[i] + "\" ";
	}
	if(!callback) {
		callback = function() { };
	}
	this._send(cmd + args, callback);
};

MPD.prototype._send = function(message, callback) {
	this._requests.push({
		message : message,
		callback : callback
	});
	//console.log("Enqueued: " + message);
	this._checkOutgoing();
};

MPD.prototype._handleResponse = function(message) {
	var callback;
	//console.log("Handling response: \"" + message + "\" active listener is " + this._activeListener);
	if(callback = this._activeListener) {
		this._activeListener = null;
		this._checkOutgoing();
		//console.log("Checking idle as message was sucessfully answered.");
		this._checkIdle();
		callback(message);
	}
};

MPD.prototype._write = function(text) {
	//console.log("SEND: " + text);
	this.client.write(text + "\n");
};
module.exports = MPD;
