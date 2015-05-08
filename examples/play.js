var MPD = require('../');
var mpd = new MPD({
	host : "localhost",
	port : process.env.MPD_PORT
});

mpd.on("ready", function() {
	mpd.play();
});

mpd.on("update", function(status) {
	console.log("Update:", status);
});

mpd.connect();
