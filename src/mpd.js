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
	this._listeners = [];
	this.status = {};
	this.server = {};
};

Util.inherits(MPD, EventEmitter);

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
	this._send("listall", function(message) {
		message = message.replace("file: ", "");
		var songs = message.split("\n");
		this.songs = [];
		for(var i = 0; i < songs.length - 2; i++) {
			this.songs.push(songs[i]);
		}
		if(callback) {
			callback(this.songs);
		}
	}.bind(this));
};

MPD.prototype.add = function(name, callback) {
	this._send("add", name, this._checkReturn.bind(this));
};

MPD.prototype.connect = function() {
	this.client = new Socket();
	this.client.setEncoding('utf8');
	this._response([this._initialGreeting.bind(this)]);
	this.client.connect(this.port, this.host, function() {
		this.client.on('data', this._onData.bind(this));
	}.bind(this));
};

MPD.prototype._initialGreeting = function(message) {
	var m;
	if(m = message.match(/OK\s(.*?)\s((:?[0-9]|\.))/)) {
		this.server.name = m[1];
		this.server.version = m[2];
	}
	else {
		throw new Error("Unknown values while receiving initial greeting");
	}
	this._enterIdle();
	this.updateStatus(this._initialStatus.bind(this));
};

MPD.prototype._initialStatus = function() {
		this.emit('ready', this.status, this.server);
};

MPD.prototype.disconnect = function() {
	this.client.destroy();
};

MPD.prototype._sendCommand = function() {
	var args = Array.prototype.slice.call(arguments);
	args.unshift(function() {
		this._enterIdle();
	}.bind(this));
	this._leaveIdle(function(r) {
		this._checkReturn(r);
		this._send.apply(this, args);
	}.bind(this));
};

MPD.prototype._enterIdle = function(callback) {
	this.client.write("idle\n");
};

MPD.prototype._leaveIdle = function(callback) {
	this._send("noidle", callback);
};

MPD.prototype._send = function() {
	var callbacks = [];
	var string = "";
	for(var i in arguments) {
		var arg = arguments[i];
		if(typeof arg === "function"){
			callbacks.push(arg);
		}
		else {
			string += arg + " ";
		}
	}
	string = string.substring(0, string.length - 1);
	//console.log("SEND: " + string);
	this._response(callbacks);
	this.client.write(string + "\n");
};

MPD.prototype._onMessage = function(message) {
	if(!message.match(/changed:\s*(.*?)\s+OK/)) {
		throw new Error("Received unknown message during idle.");
	}
	this._enterIdle();
	this.updateStatus(function(status) {
		this.emit('update', status);
	}.bind(this));
};

MPD.prototype._response = function(callbacks) {
	this._listeners.push(callbacks);
};

MPD.prototype._onData = function(message) {
	message = message.trim();
	//console.log("RECV: " + message);
	if(this._listeners.length > 0) {
		var callbacks = this._listeners.shift();
		for(var i in callbacks) {
			callbacks[i](message);
		}
	}
	else {
		this._onMessage(message);
	}
};

MPD.prototype._checkReturn = function(msg) {
	if(msg !== "OK") {
		throw new Error("Non okay return status:" + msg);
	}
};

module.exports = MPD;
