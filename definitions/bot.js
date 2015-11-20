

function start_bot_worker() {
	// workers/weather.js will runs in other process
	var worker = F.worker('bot', 'current');

	// worker === http://nodejs.org/api/child_process.html#child_process_class_childprocess
	worker.on('message', function(obj) {
		// console.log(obj);
		
	});
}

//setInterval(refresh, 5000);
F.once('load', start_bot_worker);