define(["Ti/_/declare", "Ti/_/dom", "Ti/_/event", "Ti/_/lang", "Ti/Media", "Ti/_/Evented"],
	function(declare, dom, event, lang, Media, Evented) {
	
	var doc = document,
		on = require.on,
		mimeTypes = {
			"mp3": "audio/mpeg",
			"ogg": "audio/ogg",
			"wav": "audio/wav"
		},
		INITIALIZED = 1,
		PAUSED = 2,
		PLAYING = 3,
		STARTING = 4,
		STOPPED = 5,
		STOPPING = 6,
		ENDED = 9,
		ABORT = 10,
		ERROR = 11;
	
	return declare("Ti.Media.Sound", Evented, {
		_currentState: STOPPED,
		constructor: function() {
			this._handles = [];
		},
		properties: {
			url: {
				set: function(value) {
					this.constants.__values__.playing 	= false;
					this.constants.__values__.paused 	= false;
					this._currentState = STOPPED;
					this.properties.__values__.url = value;
					this._createAudio();
					return value;
				}
			},
			volume: {
				get: function() {
					return this._audio ? this._audio.volume : 1.0;
				},
				set: function(value) {
					if (value > 1.0 )
						value = 1.0;
					else if (value < 0)	
						value = 0;
					
					this._audio && (this._audio.volume = value);
					return value;
				}
			},
			time: {
				get: function() {
					return this._audio ? this._audio.currentTime : 0; 
				},
				set: function(value) {
					this._audio && (this._audio.currentTime = value);
					console.log("this._audio=" + this._audio +"; currentTime="+this._audio.currentTime + "; "+value);
					console.dir(this._audio);
					return value;
				}
			},
			looping: {
				get: function() {
					return this._audio ? this._audio.loop : false; 
				},
				set: function(value) {
					this._audio && (this._audio.loop = value);
					return value;
				}
			}
		},
		constants: {
			paused : false,
			playing : false,
			duration : 0
		},
		_changeState: function(newState, msg) {
			this._currentState = newState;
			this.constants.__values__.playing 	= PLAYING === newState;
			this.constants.__values__.paused 	= PAUSED === newState;
			
			var evt = {};
			evt['src'] = this;
			switch (this._currentState) {
				case ENDED:
					evt['type'] = 'complete';
					evt['success'] = true;
					if (!this.properties.__values__.looping)
						this.fireEvent('complete', evt);
					break;
				case ERROR: 
					evt['type'] = 'error';	
					evt['message'] = msg;
					this.fireEvent('error', evt);
					break;
			}
		},
		_durationChange: function() {
			var d = this._audio.duration;
			if (d !== Infinity) {
				this.constants.__values__.duration = d;
			}
		},
		_createAudio: function() {
			var audio = this._audio,
				url = this.url;
			
			if (!url) {
				return;
			}
			
			if (audio && audio.parentNode) {
				return audio;
			}
			
			this.release();
			
			audio = this._audio = dom.create("audio");
			
			this._handles = [
				on(audio, "playing", this, function() {this._changeState(PLAYING, "playing");}),
				on(audio, "play", this, function() {this._changeState(STARTING, "starting");}),
				on(audio, "pause", this, function() {
					if (this._currentState === STOPPING) {
						this._stop();
					} else {
						this._changeState(PAUSED, "paused");	
					}
				}),
				
				on(audio, "ended", this, function() {
					this._changeState(ENDED, "ended");
				}),
				on(audio, "abort", this, function() {
					this._changeState(ABORT, "abort");
				}),
				on(audio, "timeupdate", this, function() {
					this._currentState === STOPPING && this.pause();
				}),
				on(audio, "error", this, function() {
					var msg = "Unknown error";
					switch (audio.error.code) {
						case 1: msg = "Aborted"; break;
						case 2: msg = "Decode error"; break;
						case 3: msg = "Network error"; break;
						case 4: msg = "Unsupported format";
					}
					
					this._changeState(ERROR, "error: " + msg);
				}),
				on(audio, "canplay", this, function() {
					this._changeState(INITIALIZED, "initialized");
				}),				
				on(audio, "durationchange", this, "_durationChange")
			];
			
			doc.body.appendChild(audio);
			
			require.is(url, "Array") || (url = [url]);
			
			for (i = 0; i < url.length; i++) {
				match = url[i].match(/.+\.([^\/\.]+?)$/);
				dom.create("source", {
					src: url[i],
					type: match && mimeTypes[match[1]]
				}, audio);
			}

			return audio;
		},
		release: function() {
			var audio = this._audio,
				parent = audio && audio.parentNode;
			this._currentState = STOPPED;
			this.constants.playing = false;
			this.constants.paused = false;
			if (parent) {
				event.off(this._handles);
				parent.removeChild(audio);
			}
			this._audio = null;
		},
		pause: function() {
			this._currentState === PLAYING && this._createAudio().pause();
		},
		start: function() {
			this._currentState !== PLAYING && this._createAudio().play();
		},
		_stop: function() {
			var v = this._audio;
			v.currentTime = 0;
			this._changeState(STOPPED, "stopped");
			
			//fix bug related to "Stop/currentTime=0" !!!
			if (v.currentTime !== 0) {
				var prevVolume = this.properties.__values__.volume;
				v.load();
				v.volume = prevVolume;
			}
		},
		stop: function() {
			var v = this._audio;
			
			if (!v)
				return;
				
			if (this._currentState === PAUSED) {
				this._stop();
			} else {
				this._changeState(STOPPING, "stopping");
				v.pause();
			}
		},
		reset: function() {
			this.stop();
		},
		isLooping: function() {
				return this._audio ? this._audio.loop : false; 
		},
		isPaused: function() {
				return this.constants.__values__.paused; 
		},
		isPlaying: function() {
				return this.constants.__values__.playing;
		}
	});

});
