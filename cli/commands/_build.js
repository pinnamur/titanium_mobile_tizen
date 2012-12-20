/*
 * build.js: Titanium Mobile Web CLI build command
 *
 * Copyright (c) 2012, Appcelerator, Inc.  All Rights Reserved.
 * See the LICENSE file for more information.
 */

var ti = require('titanium-sdk'),
	appc = require('node-appc'),
	i18n = appc.i18n(__dirname),
	__ = i18n.__,
	__n = i18n.__n,
	cleanCSS = require('clean-css'),
	afs = appc.fs,
	xml = appc.xml,
	async = require('async'),
	parallel = appc.async.parallel,
	uglify = require('uglify-js'),
	fs = require('fs'),
	path = require('path'),
	wrench = require('wrench'),
	xmldom = require('xmldom'),
	DOMParser = xmldom.DOMParser,
	jsExtRegExp = /\.js$/,
	HTML_HEADER = [
		'<!--',
		'	WARNING: this is generated code and will be lost if changes are made.',
		'	This generated source code is Copyright (c) 2010-' + (new Date).getFullYear() + ' by Appcelerator, Inc. All Rights Reserved.',
		'	-->'
		].join('\n'),
	HEADER = [
		'/**',
		' * WARNING: this is generated code and will be lost if changes are made.',
		' * This generated source code is Copyright (c) 2010-' + (new Date).getFullYear() + ' by Appcelerator, Inc. All Rights Reserved.',
		' */'
		].join('\n'),
	imageMimeTypes = {
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.jpg': 'image/jpg',
		'.jpeg': 'image/jpg'
	};

exports.config = function (logger, config, cli) {
	return {
		options: {
			'deploy-type': {
				abbr: 'D',
				default: 'development',
				desc: __('the type of deployment; production performs optimizations'),
				hint: __('type'),
				values: ['production', 'development']
			},
			'alias': {
				abbr: 'L',
				desc: __('the alias for the keystore'),
				hint: 'alias',
				prompt: {
					label: __('Keystore alias'),
					error: __('Invalid keystore alias'),
					validator: function (alias) {
						if (!alias) {
							throw new appc.exception(__('Invalid keystore alias'));
						}
						return true;
					}
				}
			},
			'dev-id': {
				abbr: 'I',
				desc: __('the id for the avd'),
				hint: __('id'),
				default: 'none'
			},
			'keystore': {
				abbr: 'K',
				desc: __('the location of the keystore file'),
				hint: 'path',
				prompt: {
					label: __('Keystore File Location'),
					error: __('Invalid keystore file'),
					validator: function (keystorePath) {
						keystorePath = afs.resolvePath(keystorePath);
						if (!afs.exists(keystorePath) || !fs.lstatSync(keystorePath).isFile()) {
							throw new appc.exception(__('Invalid keystore file location'));
						}
						return true;
					}
				}
			},
			'password': {
				abbr: 'P',
				desc: __('the password for the keystore'),
				hint: 'alias',
				password: true,
				prompt: {
					label: __('Keystore password'),
					error: __('Invalid keystore password'),
					validator: function (password) {
						if (!password) {
							throw new appc.exception(__('Invalid keystore password'));
						}
						return true;
					}
				}
			},
		}		
	};
};

exports.validate = function (logger, config, cli) {
	ti.validateProjectDir(logger, cli, cli.argv, 'project-dir');
	if (!ti.validateCorrectSDK(logger, config, cli)) {
		// we're running the build command for the wrong SDK version, gracefully return
		return false;
	}
};

exports.run = function (logger, config, cli, finished) {
	cli.fireHook('build.pre.construct', function () {
		new build(logger, config, cli, function (err) {
			cli.fireHook('build.post.compile', this, function (e) {
				if (e && e.type == 'AppcException') {
					logger.error(e.message);
					e.details.forEach(function (line) {
						line && logger.error(line);
					});
				}
				
				cli.addAnalyticsEvent('mobileweb.build.' + cli.argv['deploy-type'], {
					dir: cli.argv['project-dir'],
					name: cli.tiapp.name,
					publisher: cli.tiapp.publisher,
					url: cli.tiapp.url,
					image: cli.tiapp.image,
					appid: cli.tiapp.id,
					description: cli.tiapp.description,
					type: cli.argv.type,
					guid: cli.tiapp.guid,
					version: cli.tiapp.version,
					copyright: cli.tiapp.copyright,
					date: (new Date()).toDateString()
				});

				cli.fireHook('build.finalize', this, function () {
					finished(err);
				});
			}.bind(this));
		});
	});
};

function build(logger, config, cli, finished) {
	logger.info(__('Compiling "%s" build', cli.argv['deploy-type']));
	
	this.logger = logger;
	this.buildType = cli.argv['deploy-type'];
	this.os = cli.env.os;
	this.tiapp = cli.tiapp;
	
	this.titaniumSdkVersion = ti.manifest.version;
	this.projectDir = afs.resolvePath(cli.argv['project-dir']);
	this.projectResDir = this.projectDir + '/Resources';
	this.buildDir = this.projectDir + '/build/tizen';
	this.mobilewebSdkPath = afs.resolvePath(path.dirname(module.filename), '..', '..');
	this.mobilewebThemeDir = this.mobilewebSdkPath + '/themes';
	this.mobilewebTitaniumDir = this.mobilewebSdkPath + '/titanium';
	
	this.projectDependencies = [];
	this.modulesToLoad = [];
	this.tiModulesToLoad = [];
	this.requireCache = {};
	this.moduleMap = {};
	this.modulesToCache = [
		'Ti/_/image',
		'Ti/_/include'
	];
	this.precacheImages = [];
	this.locales = [];
	this.appNames = {};
	this.splashHtml = '';
	this.codeProcessor = cli.codeProcessor;
	this.tizenSdkDir = 'c:/tizen-sdk';
	this.targetDevice = cli.argv['dev-id'];

	var pkgJson = this.readTiPackageJson();
	this.packages = [{
		name: pkgJson.name,
		location: './titanium',
		main: pkgJson.main
	}];
	
	if (!this.dependenciesMap) {		
		this.dependenciesMap = JSON.parse(fs.readFileSync(path.join(this.mobilewebTitaniumDir, 'dependencies.json')));
	}
	
	// read the tiapp.xml and initialize some sensible defaults
	applyDefaults(this.tiapp, {
		mobileweb: {
			analytics: {
				'use-xhr': false
			},
			build: {},
			'disable-error-screen': false,
			filesystem: {
				backend: '', // blank defaults to Ti/_/Filesystem/Local
				registry: 'ondemand'
			},
			map: {
				backend: '', // blank defaults to Ti/_/Map/Google
				apikey: ''
			},
			splash: {
				enabled: true,
				'inline-css-images': false
			},
			theme: 'default'
		}
	});
	
	//adding defauld tizen values into tiapp and create/fill tizen specific settings
	this.tiapp.tizen = {
		appid : 'change1me2',
	};
	this.tiapp.tizen.appid = randomString(10);

	this.addTizenToTiAppXml();

	// tiapp are ready now, continye
	this.validateTheme();
	
	var mwBuildSettings = this.tiapp.mobileweb.build[this.buildType];
	this.minifyJS = mwBuildSettings && mwBuildSettings.js ? !!mwBuildSettings.js.minify : this.buildType == 'production';
	
	cli.fireHook('build.pre.compile', this, function (e) {
		parallel(this, [
			'copyFiles',
			'findProjectDependencies'
		], function () {
			parallel(this, [
				'createIcons',
				function (callback) {
					parallel(this, [
						'findModulesToCache',
						'findPrecacheModules',
						'findPrecacheImages',
						'findTiModules',
						'findI18N'
					], function () {
						parallel(this, [
							'findDistinctCachedModules',
							'detectCircularDependencies'
						], function () {
							this.logger.info(
								__n('Found %s dependency', 'Found %s dependencies', this.projectDependencies.length) + ', ' +
								__n('%s package', '%s packages', this.packages.length) + ', ' +
								__n('%s module', '%s modules', this.modulesToCache.length)
							);
							parallel(this, [
								'assembleTitaniumJS',
								'assembleTitaniumCSS'
							], callback);
						});
					});
				}
			], function () {
				async.series([
					function(next){
						this.minifyJavaScript();
						next(null, 'ok');
					}.bind(this), function(next){
						this.createFilesystemRegistry();
						next(null, 'ok');

					}.bind(this), function(next){
						this.createIndexHtml();
						next(null, 'ok');

					}.bind(this), function(next){
						this.createConfigXml();
						next(null, 'ok');

					}.bind(this), function(next){
						this.signTizenApp(logger, function(){
							next(null, 'ok');
						});
					}.bind(this), function(next){
						if(process.platform === 'win32'){
							this.wgtPackaging7z(logger, function(){
								next(null, 'ok');
							});
						} else{
							this.wgtPackagingLinux(logger, function(){
								next(null, 'ok');
							});
						}
					}.bind(this), function(next){
						if(!(this.targetDevice && this.targetDevice != 'none')){
							finished && finished.call(this);
						}else{							
							this.detectTizenSDK(logger, next);
						}
					}.bind(this),function(next){
						this.runOnDevice(logger, function(){
							finished && finished.call(this);	
						});						
					}.bind(this)

					], function(err){
						if(err) 
							console.log(err)
						else {

							console.log('Failed...')
						}
				});
			});
		});
	}.bind(this));
};

build.prototype = {

	readTiPackageJson: function () {
		this.logger.info(__('Reading Titanium Mobile Web package.json file'));
		var mwPackageFile = this.mobilewebSdkPath + '/titanium/package.json';
		afs.exists(mwPackageFile) || badInstall(__('Unable to find Titanium Mobile Web package.json file'));
		try {
			return JSON.parse(fs.readFileSync(mwPackageFile));
		} catch (e) {
			badInstall(__("Unable to parse Titanium Mobile Web's package.json file"));
		}
	},
	
	validateTheme: function () {
		this.logger.info(__('Validating theme'));
		this.theme = this.tiapp.mobileweb.theme || 'default';
		if (!afs.exists(this.mobilewebThemeDir + '/' + this.theme)) {
			logger.error(__('Unable to find the "%s" theme. Please verify the theme setting in the tiapp.xml.', this.theme) + '\n');
			process.exit(1);
		}
		this.logger.debug(__('Using %s theme', this.theme.cyan));
	},
	
	copyFiles: function (callback) {
		this.logger.info(__('Copying project files'));
		if (afs.exists(this.buildDir)) {
			this.logger.debug(__('Deleting existing build directory'));
			wrench.rmdirSyncRecursive(this.buildDir);
		}
		wrench.mkdirSyncRecursive(this.buildDir);
		afs.copyDirSyncRecursive(this.mobilewebThemeDir, this.buildDir + '/themes', { preserve: true, logger: this.logger.debug });
		afs.copyDirSyncRecursive(this.mobilewebTitaniumDir, this.buildDir + '/titanium', { preserve: true, logger: this.logger.debug });
		afs.copyDirSyncRecursive(this.projectResDir, this.buildDir, { preserve: true, logger: this.logger.debug, rootIgnore: ti.filterPlatforms('mobileweb') });
		if (afs.exists(this.projectResDir, 'mobileweb')) {
			afs.copyDirSyncRecursive(this.projectResDir + '/mobileweb', this.buildDir + '/mobileweb', { preserve: true, logger: this.logger.debug, rootIgnore: ['apple_startup_images', 'splash'] });
			['Default.jpg', 'Default-Portrait.jpg', 'Default-Landscape.jpg'].forEach(function (file) {
				file = this.projectResDir + '/mobileweb/apple_startup_images/' + file;
				if (afs.exists(file)) {
					afs.copyFileSync(file, this.buildDir, { logger: this.logger.debug });
					afs.copyFileSync(file, this.buildDir + '/mobileweb/apple_startup_images', { logger: this.logger.debug });
				}
			}, this);
		}
		callback();
	},
	
	findProjectDependencies: function (callback) {
		this.logger.info(__('Finding all Titanium API dependencies'));
		if (this.codeProcessor && this.codeProcessor.plugins['ti-api-usage-finder']) {
			var usedAPIs = this.codeProcessor.plugins['ti-api-usage-finder'],
				p;
			this.projectDependencies = ['Ti'];
			for(p in usedAPIs) {
				p = p.replace('Titanium', 'Ti').replace(/\./g,'/');
				if (p in this.dependenciesMap && !~this.projectDependencies.indexOf(p)) {
					// TODO: debug log!
					this.projectDependencies.push(p);
				}
			}
		} else {
			this.projectDependencies = Object.keys(this.dependenciesMap);
		}
		callback();
	},
	
	findModulesToCache: function (callback) {
		this.logger.info(__('Finding all required modules to be cached'));
		this.projectDependencies.forEach(function (mid) {
			this.parseModule(mid);
		}, this);
		this.modulesToCache = this.modulesToCache.concat(Object.keys(this.requireCache));
		callback();
	},
	
	findPrecacheModules: function (callback) {
		this.logger.info(__('Finding all precached modules'));
		var mwTiapp = this.tiapp.mobileweb;
		if (mwTiapp.precache) {
			mwTiapp.precache.require && mwTiapp.precache.require.forEach(function (x) {
				this.modulesToCache.push('commonjs:' + x);
			}, this);
			mwTiapp.precache.includes && mwTiapp.precache.includes.forEach(function (x) {
				this.modulesToCache.push('url:' + x);
			}, this);
		}
		callback();
	},
	
	findDistinctCachedModules: function (callback) {
		this.logger.info(__('Finding all distinct cached modules'));
		var depMap = {};
		this.modulesToCache.forEach(function (m) {
			for (var i in this.moduleMap) {
				if (this.moduleMap.hasOwnProperty(i) && this.moduleMap[i].indexOf(m) != -1) {
					depMap[m] = 1;
				}
			}
		}, this);
		Object.keys(this.moduleMap).forEach(function (m) {
			depMap[m] || this.modulesToLoad.push(m);
		}, this);
		callback();
	},
	
	findPrecacheImages: function (callback) {
		this.logger.info(__('Finding all precached images'));
		this.moduleMap['Ti/UI/TableViewRow'] && this.precacheImages.push('/themes/' + this.theme + '/UI/TableViewRow/child.png');
		var images = (this.tiapp.mobileweb.precache && this.tiapp.mobileweb.precache.images) || [];
		images && (this.precacheImages = this.precacheImages.concat(images));
		callback();
	},
	
	findTiModules: function (callback) {
		if (!this.tiapp.modules || !this.tiapp.modules.length) {
			this.logger.info(__('No Titanium Modules required, continuing'));
			callback();
			return;
		}
		
		this.logger.info(__n('Searching for %s Titanium Module', 'Searching for %s Titanium Modules', this.tiapp.modules.length));
		appc.timodule.find(this.tiapp.modules, 'mobileweb', this.deployType, this.titaniumSdkVersion, this.projectDir, this.logger, function (modules) {
			if (modules.missing.length) {
				this.logger.error(__('Could not find all required Titanium Modules:'))
				modules.missing.forEach(function (m) {
					this.logger.error('   id: ' + m.id + '\t version: ' + (m.version || 'latest') + '\t platform: ' + m.platform);
				}, this);
				this.logger.log();
				process.exit(1);
			}
			
			if (modules.incompatible.length) {
				this.logger.error(__('Found incompatible Titanium Modules:'));
				modules.incompatible.forEach(function (m) {
					this.logger.error('   id: ' + m.id + '\t version: ' + (m.version || 'latest') + '\t platform: ' + m.platform + '\t min sdk: ' + m.minsdk);
				}, this);
				this.logger.log();
				process.exit(1);
			}
			
			modules.found.forEach(function (module) {
				var moduleDir = module.modulePath,
					pkgJson,
					pkgJsonFile = path.join(moduleDir, 'package.json');
				if (!afs.exists(pkgJsonFile)) {
					this.logger.error(__('Invalid Titanium Mobile Module "%s": missing package.json', module.id) + '\n');
					process.exit(1);
				}
				
				try {
					pkgJson = JSON.parse(fs.readFileSync(pkgJsonFile));
				} catch (e) {
					this.logger.error(__('Invalid Titanium Mobile Module "%s": unable to parse package.json', module.id) + '\n');
					process.exit(1);
				}
				
				var libDir = ((pkgJson.directories && pkgJson.directories.lib) || '').replace(/^\//, '');
				
				var mainFilePath = path.join(moduleDir, libDir, (pkgJson.main || '').replace(jsExtRegExp, '') + '.js')
				if (!afs.exists(mainFilePath)) {
					this.logger.error(__('Invalid Titanium Mobile Module "%s": unable to find main file "%s"', module.id, pkgJson.main) + '\n');
					process.exit(1);
				}
				
				this.logger.info(__('Bundling Titanium Mobile Module %s', module.id.cyan));
				
				this.projectDependencies.push(pkgJson.main);
				
				var moduleName = module.id != pkgJson.main ? module.id + '/' + pkgJson.main : module.id;
				
				if (/\/commonjs/.test(moduleDir)) {
					this.modulesToCache.push((/\/commonjs/.test(moduleDir) ? 'commonjs:' : '') + moduleName);
				} else {
					this.modulesToCache.push(moduleName);
					this.tiModulesToLoad.push(module.id);
				}
				
				this.packages.push({
					'name': module.id,
					'location': './' + this.collapsePath('modules/' + module.id + (libDir ? '/' + libDir : '')),
					'main': pkgJson.main,
					'root': 1
				});
				
				// TODO: need to combine ALL Ti module .js files into the titanium.js, not just the main file
				
				// TODO: need to combine ALL Ti module .css files into the titanium.css
				
				var dest = path.join(this.buildDir, 'modules', module.id);
				wrench.mkdirSyncRecursive(dest);
				afs.copyDirSyncRecursive(moduleDir, dest, { preserve: true });
			}, this);
			
			callback();
		}.bind(this));
	},
	
	detectCircularDependencies: function (callback) {
		this.modulesToCache.forEach(function (m) {
			var deps = this.moduleMap[m];
			deps && deps.forEach(function (d) {
				if (this.moduleMap[d] && this.moduleMap[d].indexOf(m) != -1) {
					this.logger.warn(__('Circular dependency detected: %s dependent on %s'), m, d);
				}
			}, this);
		}, this);
		callback();
	},
	
	findI18N: function (callback) {
		var data = ti.i18n.load(this.projectDir, this.logger),
			precacheLocales = (this.tiapp.precache || {}).locales || {};
		
		Object.keys(data).forEach(function (lang) {
			data[lang].app && data[lang].appname && (self.appNames[lang] = data[lang].appname);
			if (data[lang].strings) {
				var dir = path.join(this.buildDir, 'titanium', 'Ti', 'Locale', lang);
				wrench.mkdirSyncRecursive(dir);
				fs.writeFileSync(path.join(dir, 'i18n.js'), 'define(' + JSON.stringify(data[lang].strings, null, '\t') + ')');
				this.locales.push(lang);
				precacheLocales[lang] && this.modulesToCache.push('Ti/Locale/' + lang + '/i18n');
			};
		}, this);
		
		callback();
	},
	
	assembleTitaniumJS: function (callback) {
		this.logger.info(__('Assembling titanium.js'));
		
		var tiapp = this.tiapp,
			tiJS = [
				HEADER, '\n',
				
				// 1) read in the config.js and fill in the template
				renderTemplate(fs.readFileSync(this.mobilewebSdkPath + '/src/config.js').toString(), {
					app_analytics: tiapp.analytics,
					app_copyright: tiapp.copyright,
					app_description: tiapp.description,
					app_guid: tiapp.guid,
					app_id: tiapp.id,
					app_name: tiapp.name,
					app_names: JSON.stringify(this.appNames),
					app_publisher: tiapp.publisher,
					app_url: tiapp.url,
					app_version: tiapp.version,
					deploy_type: this.buildType,
					locales: JSON.stringify(this.locales),
					packages: JSON.stringify(this.packages),
					project_id: tiapp.id,
					project_name: tiapp.name,
					ti_fs_registry: tiapp.mobileweb.filesystem.registry,
					ti_theme: this.theme,
					ti_githash: ti.manifest.githash,
					ti_timestamp: ti.manifest.timestamp,
					ti_version: ti.manifest.version,
					has_analytics_use_xhr: tiapp.mobileweb.analytics ? tiapp.mobileweb.analytics['use-xhr'] === true : false,
					has_show_errors: this.buildType != 'production' && tiapp.mobileweb['disable-error-screen'] !== true,
					has_instrumentation: !!tiapp.mobileweb.instrumentation
				}),
				
				'\n', '\n'
			];
		
		// 2) copy in instrumentation if it's enabled
		!tiapp.mobileweb.instrumentation || tiJS.push(fs.readFileSync(this.mobilewebSdkPath + '/src/instrumentation.js').toString() + '\n');
		
		// 3) copy in the loader
		tiJS.push(fs.readFileSync(this.mobilewebSdkPath + '/src/loader.js').toString() + '\n\n');
		
		// 4) cache the dependencies
		var first = true,
			requireCacheWritten = false,
			moduleCounter = 0;
		
		// uncomment next line to bypass module caching (which is ill advised):
		// return it back, do not bypass caching. Does we need pre-caching in Tizen app at all? Needs more tests, do not see any profit fron this for now.
		this.modulesToCache = [];
		
		this.modulesToCache.forEach(function (moduleName) {
			var isCommonJS = false;
			if (/^commonjs\:/.test(moduleName)) {
				isCommonJS = true;
				moduleName = moduleName.substring(9);
			}
			
			var dep = this.resolveModuleId(moduleName);
			if (!dep.length) return;
			
			if (!requireCacheWritten) {
				tiJS.push('require.cache({\n');
				requireCacheWritten = true;
			}
			
			first || tiJS.push(',\n');
			first = false;
			moduleCounter++;
			
			var file = path.join(dep[0], jsExtRegExp.test(dep[1]) ? dep[1] : dep[1] + '.js');
			
			if (/^url\:/.test(moduleName)) {
				if (this.minifyJS) {
					var pro = uglify.uglify,
						source = file + '.uncompressed.js';
					
					fs.renameSync(file, source);
					this.logger.debug(__('Minifying include %s', file));
					fs.writeFileSync(file, pro.gen_code(pro.ast_squeeze(pro.ast_mangle(uglify.parser.parse(fs.readFileSync(source).toString())))));
				}
				tiJS.push('"' + moduleName + '":"' + fs.readFileSync(file).toString().trim().replace(/\\/g, '\\\\').replace(/\n/g, '\\n\\\n').replace(/"/g, '\\"') + '"');
			} else if (isCommonJS) {
				tiJS.push('"' + moduleName + '":function(){\n/* ' + file.replace(this.buildDir, '') + ' */\ndefine(function(require,exports,module){\n' + fs.readFileSync(file).toString() + '\n});\n}');
			} else {
				tiJS.push('"' + moduleName + '":function(){\n/* ' + file.replace(this.buildDir, '') + ' */\n\n' + fs.readFileSync(file).toString() + '\n}');
			}
		}, this);
		
		this.precacheImages.forEach(function (url) {
			url = url.replace(/\\/g, '/');
			
			var img = path.join(this.projectResDir, /^\//.test(url) ? '.' + url : url),
				type = imageMimeTypes[img.match(/(\.[a-zA-Z]{3})$/)[1]];
			
			if (afs.exists(img) && type) {
				if (!requireCacheWritten) {
					tiJS.push('require.cache({');
					requireCacheWritten = true;
				}
				
				first || tiJS.push(',\n');
				first = false;
				moduleCounter++;
				
				tiJS.push('"url:' + url + '":"data:' + type + ';base64,' + fs.readFileSync(img).toString('base64') + '"');
			}
		});
		
		requireCacheWritten && tiJS.push('});\n');
		
		// 4) write the ti.app.properties
		var props = this.tiapp.properties || {};
		this.tiapp.mobileweb.filesystem.backend && (props['ti.fs.backend'] = { type: 'string', value: this.tiapp.mobileweb.filesystem.backend });
		this.tiapp.mobileweb.map.backend && (props['ti.map.backend'] = { type: 'string', value: this.tiapp.mobileweb.map.backend });
		this.tiapp.mobileweb.map.apikey && (props['ti.map.apikey'] = { type: 'string', value: this.tiapp.mobileweb.map.apikey });
		
		tiJS.push('require("Ti/App/Properties", function(p) {\n');
		Object.keys(props).forEach(function (name) {
			var prop = props[name],
				type = prop.type || 'string';
			tiJS.push('\tp.set' + type.charAt(0).toUpperCase() + type.substring(1).toLowerCase() + '("'
				+ name.replace(/"/g, '\\"') + '",' + (type == 'string' ? '"' + prop.value.replace(/"/g, '\\"') + '"': prop.value) + ');\n');
		});
		tiJS.push('});\n');
		
		// 5) write require() to load all Ti modules
		this.modulesToLoad.sort();
		this.modulesToLoad = this.modulesToLoad.concat(this.tiModulesToLoad);
		tiJS.push('require(' + JSON.stringify(this.modulesToLoad) + ');\n');
		
		fs.writeFileSync(this.buildDir + '/titanium.js', tiJS.join(''));
		
		callback();
	},
	
	minifyJavaScript: function () {
		if (this.minifyJS) {
			this.logger.info(__('Minifying JavaScript'));
			var pro = uglify.uglify,
				self = this;
			(function walk(dir) {
				fs.readdirSync(dir).sort().forEach(function (dest) {
					var stat = fs.statSync(dir + '/' + dest);
					if (stat.isDirectory()) {
						walk(dir + '/' + dest);
					} else if (jsExtRegExp.test(dest)) {
						dest = dir + '/' + dest;
						var source = dest + '.uncompressed.js';
						fs.renameSync(dest, source);
						self.logger.debug(__('Minifying include %s', dest));
						fs.writeFileSync(dest, pro.gen_code(pro.ast_squeeze(pro.ast_mangle(uglify.parser.parse(fs.readFileSync(source).toString())))));
					}
				});
			}(this.buildDir))
		}
	},
	
	assembleTitaniumCSS: function (callback) {
		var tiCSS = [
			HEADER, '\n'
		];
		
		if (this.tiapp.mobileweb.splash.enabled) {
			var splashDir = this.projectResDir + '/mobileweb/splash',
				splashHtmlFile = splashDir + '/splash.html',
				splashCssFile = splashDir + '/splash.css';
			if (afs.exists(splashDir)) {
				this.logger.info(__('Processing splash screen'));
				afs.exists(splashHtmlFile) && (this.splashHtml = fs.readFileSync(splashHtmlFile));
				if (afs.exists(splashCssFile)) {
					var css = fs.readFileSync(splashCssFile).toString();
					if (this.tiapp.mobileweb.splash['inline-css-images']) {
						var parts = css.split('url('),
							i = 1, p, img, imgPath, imgType,
							len = parts.length;
						for (; i < len; i++) {
							p = parts[i].indexOf(')');
							if (p != -1) {
								img = parts[i].substring(0, p).replace(/["']/g, '').trim();
								if (!/^data\:/.test(img)) {
									imgPath = img.charAt(0) == '/' ? this.projectResDir + img : splashDir + '/' + img;
									imgType = imageMimeTypes[imgPath.match(/(\.[a-zA-Z]{3})$/)[1]];
									if (afs.exists(imgPath) && imgType) {
										parts[i] = 'data:' + imgType + ';base64,' + fs.readFileSync(imgPath).toString('base64') + parts[i].substring(p);
									}
								}
							}
						}
						css = parts.join('url(');
					}
					tiCSS.push(css);
				}
			}
		}
		
		this.logger.info(__('Assembling titanium.css'));
		
		var commonCss = this.mobilewebThemeDir + '/common.css';
		afs.exists(commonCss) && tiCSS.push(fs.readFileSync(commonCss).toString());
		
		// TODO: need to rewrite absolute paths for urls
		
		// TODO: code below does NOT inline imports, nor remove them... do NOT use imports until themes are fleshed out
		
		var themePath = this.projectResDir + '/themes/' + this.theme;
		afs.exists(themePath) || (themePath = this.projectResDir + '/' + this.theme);
		afs.exists(themePath) || (themePath = this.mobilewebSdkPath + '/themes/' + this.theme);
		if (!afs.exists(themePath)) {
			this.logger.error(__('Unable to locate theme "%s"', this.theme) + '\n');
			process.exit(1);
		}
		
		wrench.readdirSyncRecursive(themePath).forEach(function (file) {
			/\.css$/.test(file) && tiCSS.push(fs.readFileSync(themePath + '/' + file).toString() + '\n');
		});
		
		// detect any fonts and add font face rules to the css file
		var fonts = {};
		wrench.readdirSyncRecursive(this.projectResDir).forEach(function (file) {
			var match = file.match(/^(.+)(\.otf|\.woff)$/);
			if (match) {
				fonts[match[0]] || (fonts[match[0]] = []);
				fonts[match[0]].push(file);
			}
		});
		Object.keys(fonts).forEach(function (name) {
			tiCSS.push('@font-face{font-family:' + name + ';src:url(' + fonts[name] + ');\n');
		});
		
		// TODO: minify the css
		
		// write the titanium.css
		fs.writeFileSync(this.buildDir + '/titanium.css', cleanCSS.process(tiCSS.join('')));

		callback();
	},
	
	createIcons: function (callback) {
		//just show log and go to next. TODO: fix this function if we really have to use it on Tizen
		this.logger.info(__('createIcons: Dissabled. Creating favicon and Apple touch icons'));
		afs.copyFileSync(path.join(this.projectResDir, 'mobileweb', 'appicon.png'), this.buildDir, { logger: this.logger.debug });
		callback();

		// this.logger.info(__('Creating favicon and Apple touch icons'));
		
		// var file = path.join(this.projectResDir, this.tiapp.icon);
		// if (!/\.(png|jpg|gif)$/.test(file) || !afs.exists(file)) {
		// 	file = path.join(this.projectResDir, 'mobileweb', 'appicon.png');
		// }
		
		// if (afs.exists(file)) {
		// 	afs.copyFileSync(file, this.buildDir, { logger: this.logger.debug });
			
		// 	appc.image.resize(file, [
		// 		{ file: this.buildDir + '/favicon.ico', width: 16, height: 16 },
		// 		{ file: this.buildDir + '/apple-touch-icon-precomposed.png', width: 57, height: 57 },
		// 		{ file: this.buildDir + '/apple-touch-icon-57x57-precomposed.png', width: 57, height: 57 },
		// 		{ file: this.buildDir + '/apple-touch-icon-72x72-precomposed.png', width: 72, height: 72 },
		// 		{ file: this.buildDir + '/apple-touch-icon-114x114-precomposed.png', width: 114, height: 114 },
		// 	], function (err, stdout, stderr) {
		// 		if (err) {
		// 			this.logger.error(__('Failed to create icons'));
		// 			stderr && stderr.toString().split('\n').forEach(function (line) {
		// 				line && this.logger.error(line);
		// 			}, this);
		// 			process.exit(1);
		// 		}
		// 		callback();
		// 	}.bind(this));
		// } else {
		// 	callback();
		// }
	},
	
	createFilesystemRegistry: function () {
		this.logger.info(__('Creating the filesystem registry'));
		var registry = 'ts\t' + fs.statSync(this.buildDir).ctime.getTime() + '\n' +
			(function walk(dir, depth) {
				var s = '';
				depth = depth | 0;
				fs.readdirSync(dir).sort().forEach(function (file) {
					// TODO: screen out specific file/folder patterns (i.e. uncompressed js files)
					var stat = fs.statSync(dir + '/' + file);
					if (stat.isDirectory()) {
						s += (depth ? (new Array(depth + 1)).join('\t') : '') + file + '\n' + walk(dir + '/' + file, depth + 1);
					} else {
						s += (depth ? (new Array(depth + 1)).join('\t') : '') + file + '\t' + stat.size + '\n';
					}
				});
				return s;
			}(this.buildDir)).trim();
		
		fs.writeFileSync(this.buildDir + '/titanium/filesystem.registry', registry);
		
		if (this.tiapp.mobileweb.filesystem.registry == 'preload') {
			fs.appendFileSync(this.buildDir + '/titanium.js', 'require.cache({"url:/titanium/filesystem.registry":"' + registry.replace(/\n/g, '|') + '"});');
		}
	},
	
	createIndexHtml: function () {
		this.logger.info(__('Creating the index.html'));
		
		// get status bar style
		var statusBarStyle = 'default';
		if (this.tiapp['statusbar-style']) {
			statusBarStyle = this.tiapp['statusbar-style'];
			if (/^opaque_black|opaque$/.test(statusBarStyle)) {
				statusBarStyle = 'black';
			} else if (/^translucent_black|transparent|translucent$/.test(statusBarStyle)) {
				statusBarStyle = 'black-translucent';
			} else {
				statusBarStyle = 'default';
			}
		}
		
		// write the index.html
		fs.writeFileSync(this.buildDir + '/index.html', renderTemplate(fs.readFileSync(this.mobilewebSdkPath + '/src/index.html').toString().trim(), {
			ti_header: HTML_HEADER,
			project_name: this.tiapp.name || '',
			app_description: this.tiapp.description || '',
			app_publisher: this.tiapp.publisher || '',
			ti_generator: 'Appcelerator Titanium Mobile ' + ti.manifest.version,
			ti_statusbar_style: statusBarStyle,
			ti_css: fs.readFileSync(this.buildDir + '/titanium.css').toString(),
			splash_screen: this.splashHtml,
			ti_js: fs.readFileSync(this.buildDir + '/titanium.js').toString()
		}));
	},

	addTizenToTiAppXml: function (tizenAppId){		
		this.logger.info('Processing tiapp.xml for tizen node');
		var XMLSerializer = xmldom.XMLSerializer;

		var xmlpath = path.join(this.projectDir, 'tiapp.xml');
		var doc = new DOMParser().parseFromString(fs.readFileSync(xmlpath).toString(), 'text/xml');
		var parsedTiXml = doc.documentElement;
		//check for Tizen section
		var tizenTagFound = false;
		var node = parsedTiXml.firstChild;

		while (node) {
			if (node.nodeType == 1 && node.tagName == 'tizen'){
				//tizen section exists, nothing to do
				tizenTagFound = true;
				var existingId =  node.getAttribute('appid');
				this.logger.info('<tizen> node. tizen app id:' +  existingId);
				if(existingId){
					this.tiapp.tizen.appid = existingId;
				}
			}
			node = node.nextSibling;
		}

		if(tizenTagFound){
			this.logger.info('<tizen> node available.');
			return;
		}
		this.logger.info('<tizen> node absent in tiapp.xml, adding it.');
		
		//no tizen section in xml, add it
		var tizenSectionStr = '<tizen appid="' + this.tiapp.tizen.appid+'"><feature name="http://tizen.org/api/alarm" required="true"/><feature name="http://tizen.org/api/alarm.read" required="true"/><feature name="http://tizen.org/api/alarm.write" required="true"/><feature name="http://tizen.org/api/application" required="true"/><feature name="http://tizen.org/api/application.kill" required="true"/><feature name="http://tizen.org/api/application.launch" required="true"/><feature name="http://tizen.org/api/application.read" required="true"/><feature name="http://tizen.org/api/bluetooth" required="true"/><feature name="http://tizen.org/api/bluetooth.admin" required="true"/><feature name="http://tizen.org/api/bluetooth.gap" required="true"/><feature name="http://tizen.org/api/bluetooth.spp" required="true"/><feature name="http://tizen.org/api/calendar" required="true"/><feature name="http://tizen.org/api/calendar.read" required="true"/><feature name="http://tizen.org/api/calendar.write" required="true"/><feature name="http://tizen.org/api/call" required="true"/><feature name="http://tizen.org/api/call.history" required="true"/><feature name="http://tizen.org/api/call.history.read" required="true"/><feature name="http://tizen.org/api/call.history.write" required="true"/><feature name="http://tizen.org/api/call.state" required="true"/><feature name="http://tizen.org/api/contact" required="true"/><feature name="http://tizen.org/api/contact.read" required="true"/><feature name="http://tizen.org/api/contact.write" required="true"/><feature name="http://tizen.org/api/download" required="true"/><feature name="http://tizen.org/api/filesystem" required="true"/><feature name="http://tizen.org/api/filesystem.read" required="true"/><feature name="http://tizen.org/api/filesystem.write" required="true"/><feature name="http://tizen.org/api/geocoder" required="true"/><feature name="http://tizen.org/api/lbs" required="true"/><feature name="http://tizen.org/api/mediacontent" required="true"/><feature name="http://tizen.org/api/mediacontent.read" required="true"/><feature name="http://tizen.org/api/mediacontent.write" required="true"/><feature name="http://tizen.org/api/messaging" required="true"/><feature name="http://tizen.org/api/messaging.read" required="true"/><feature name="http://tizen.org/api/messaging.send" required="true"/><feature name="http://tizen.org/api/messaging.write" required="true"/><feature name="http://tizen.org/api/nfc" required="true"/><feature name="http://tizen.org/api/nfc.admin" required="true"/><feature name="http://tizen.org/api/nfc.p2p" required="true"/><feature name="http://tizen.org/api/nfc.tag" required="true"/><feature name="http://tizen.org/api/notification" required="true"/><feature name="http://tizen.org/api/power" required="true"/><feature name="http://tizen.org/api/systeminfo" required="true"/><feature name="http://tizen.org/api/time" required="true"/><feature name="http://tizen.org/api/time.read" required="true"/><feature name="http://tizen.org/api/time.write" required="true"/><feature name="http://tizen.org/api/tizen" required="true"/><access origin="*"/></tizen>';
		var tizenSec = new DOMParser().parseFromString(tizenSectionStr, 'text/xml');
		parsedTiXml.appendChild(tizenSec);
		var result = new XMLSerializer().serializeToString(doc);
		fs.writeFileSync(xmlpath, result, 'utf8');
	},

	createConfigXml: function () {
		this.logger.info(__('createConfigXml'));
		var allTizenFeatures = '<feature name="http://tizen.org/api/alarm" required="true"/><feature name="http://tizen.org/api/alarm.read" required="true"/><feature name="http://tizen.org/api/alarm.write" required="true"/><feature name="http://tizen.org/api/application" required="true"/><feature name="http://tizen.org/api/application.kill" required="true"/><feature name="http://tizen.org/api/application.launch" required="true"/><feature name="http://tizen.org/api/application.read" required="true"/><feature name="http://tizen.org/api/bluetooth" required="true"/><feature name="http://tizen.org/api/bluetooth.admin" required="true"/><feature name="http://tizen.org/api/bluetooth.gap" required="true"/><feature name="http://tizen.org/api/bluetooth.spp" required="true"/><feature name="http://tizen.org/api/calendar" required="true"/><feature name="http://tizen.org/api/calendar.read" required="true"/><feature name="http://tizen.org/api/calendar.write" required="true"/><feature name="http://tizen.org/api/call" required="true"/><feature name="http://tizen.org/api/call.history" required="true"/><feature name="http://tizen.org/api/call.history.read" required="true"/><feature name="http://tizen.org/api/call.history.write" required="true"/><feature name="http://tizen.org/api/call.state" required="true"/><feature name="http://tizen.org/api/contact" required="true"/><feature name="http://tizen.org/api/contact.read" required="true"/><feature name="http://tizen.org/api/contact.write" required="true"/><feature name="http://tizen.org/api/download" required="true"/><feature name="http://tizen.org/api/filesystem" required="true"/><feature name="http://tizen.org/api/filesystem.read" required="true"/><feature name="http://tizen.org/api/filesystem.write" required="true"/><feature name="http://tizen.org/api/geocoder" required="true"/><feature name="http://tizen.org/api/lbs" required="true"/><feature name="http://tizen.org/api/mediacontent" required="true"/><feature name="http://tizen.org/api/mediacontent.read" required="true"/><feature name="http://tizen.org/api/mediacontent.write" required="true"/><feature name="http://tizen.org/api/messaging" required="true"/><feature name="http://tizen.org/api/messaging.read" required="true"/><feature name="http://tizen.org/api/messaging.send" required="true"/><feature name="http://tizen.org/api/messaging.write" required="true"/><feature name="http://tizen.org/api/nfc" required="true"/><feature name="http://tizen.org/api/nfc.admin" required="true"/><feature name="http://tizen.org/api/nfc.p2p" required="true"/><feature name="http://tizen.org/api/nfc.tag" required="true"/><feature name="http://tizen.org/api/notification" required="true"/><feature name="http://tizen.org/api/power" required="true"/><feature name="http://tizen.org/api/systeminfo" required="true"/><feature name="http://tizen.org/api/time" required="true"/><feature name="http://tizen.org/api/time.read" required="true"/><feature name="http://tizen.org/api/time.write" required="true"/><feature name="http://tizen.org/api/tizen" required="true"/><access origin="*"/>';

		var templt = fs.readFileSync(path.join(this.mobilewebSdkPath, 'templates', 'app', 'config.tmpl'), 'utf8').toString();
		templt = templt.replace('%%WIDGET_ID%%', this.tiapp.url );
		templt = templt.replace('%%WIDGET_NAME%%', this.tiapp.name);
		templt = templt.replace('%%APP_ID%%', this.tiapp.tizen.appid);
		templt = templt.replace('%%FEATURES_LIST%%', allTizenFeatures);
		fs.writeFileSync(path.join(this.buildDir, 'config.xml'), templt, 'utf8');
	},

	collapsePath: function (p) {
		var result = [], segment, lastSegment;
		p = p.replace(/\\/g, '/').split('/');
		while (p.length) {
			segment = p.shift();
			if (segment == '..' && result.length && lastSegment != '..') {
				result.pop();
				lastSegment = result[result.length - 1];
			} else if (segment != '.') {
				result.push(lastSegment = segment);
			}
		}
		return result.join('/');
	},
	
	resolveModuleId: function (mid, ref) {
		var parts = mid.split('!');
		mid = parts[parts.length-1];
		
		if (/^url\:/.test(mid)) {
			mid = mid.substring(4);
			if (/^\//.test(mid)) {
				mid = '.' + mid;
			}
			parts = mid.split('/');
			for (var i = 0, l = this.packages.length; i < l; i++) {
				if (this.packages[i].name == parts[0]) {
					return [this.collapsePath(this.buildDir + '/' + this.packages[i].location), mid];
				}
			}
			return [this.buildDir, mid];
		}
		
		if (mid.indexOf(':') != -1) return [];
		if (/^\//.test(mid) || (parts.length == 1 && jsExtRegExp.test(mid))) return [this.buildDir, mid];
		/^\./.test(mid) && ref && (mid = this.collapsePath(ref + mid));
		parts = mid.split('/');
		
		for (var i = 0, l = this.packages.length; i < l; i++) {
			if (this.packages[i].name == parts[0]) {
				this.packages[i].name != 'Ti' && (mid = mid.replace(this.packages[i].name + '/', ''));
				return [this.collapsePath(this.buildDir + '/' + this.packages[i].location), mid];
			}
		}
		
		return [this.buildDir, mid];
	},
	
	parseModule: function (mid, ref) {
		if (this.requireCache[mid] || mid == 'require') {
			return;
		}
		
		var parts = mid.split('!');
		
		if (parts.length == 1) {
			if (mid.charAt(0) == '.' && ref) {
				mid = this.collapsePath(ref + mid);
			}
			this.requireCache[mid] = 1;
		}
		
		var dep = this.resolveModuleId(mid, ref);
		if (!dep.length) {
			return;
		}
		
		parts.length > 1 && (this.requireCache['url:' + parts[1]] = 1);

		var deps = this.dependenciesMap[dep[1]];
		if(deps){
			for (var i = 0, l = deps.length; i < l; i++) {
				dep = deps[i];
				ref = mid.split('/');
				ref.pop();
				ref = ref.join('/') + '/';
				this.parseModule(dep, ref);
			}
			this.moduleMap[mid] = deps;
		}
	},
	wgtPackaging7z: function(logger, callback){
		logger.info(__('Packaging application into wgt'));

		logger.info(__('wgtPackaging7z  buildDir "%s" ', this.buildDir));
		var packer = require('child_process');

		// Create the tasks to unzip each entry in the zip file
		var child,
		stdout = '',
		stderr = '';

		child = packer.spawn(path.resolve(this.find7za(logger).toString()), ['a', path.join(this.buildDir, 'tizenapp.wgt'), this.buildDir + '/*', '-tzip']);
		child.stdout.on('data', function (data) {
			stdout += data.toString();
		});
		child.on('exit', function (code, signal) {
			if (callback) {
				if (code) {
					// if we're on windows, the error message is actually in stdout, so scan for it
					if (process.platform === 'win32') {
						var foundError = false,
							err = [];
						
						stdout.split('\n').forEach(function (line) {
							if (/^Error\:/.test(line)) {
								foundError = true;
							}
							if (foundError) {
								line && err.push(line.trim());
							}
						});
						
						if (err.length) {
							stderr = err.join('\n') + stderr;
						}
					}
					callback();
				} else {
					callback();
				}
			}
		});		
	},
	wgtPackagingLinux : function(logger, callback){
		logger.info('Packaging application into wgt');
		var packer = require('child_process');
		var cmdzip = 'zip -r "' + path.join(this.buildDir, 'tizenapp.wgt') + '" *';
		console.log('zip cmd: ' + cmdzip);
		packer.exec(
			cmdzip,
			{
				cwd: this.buildDir
			},
			function (err, stdout, stderr) {
				logger.info(stdout);
				if(err != null){
					logger.info(stderr);
				}else{
					logger.info('compressing ok');
				}
				callback();
			}
		);			
	},
	runOnDevice : function(logger, callback){		
		if(this.targetDevice && this.targetDevice != 'none'){
			var runner = require("child_process");
			var pathToCmd = path.join(this.tizenSdkDir, 'tools', 'ide', 'bin', 'web-install.bat');
			var pathToWgt = path.join(this.buildDir, 'tizenapp.wgt');
			var cmd = pathToCmd + ' --id=' + this.tiapp.url +' --widget=' + pathToWgt;
			logger.info('install cmd: ' + cmd);
			runner.exec(
				cmd,
				function (err, stdout, stderr) {
					logger.info(stdout);
					if(err != null){
						logger.info('wgt installation failed');
						logger.info(stderr);
					}else{
						logger.info('Installed wgt: ' + pathToWgt);
					}
					callback();
			});	
		}else{
			callback();
		}		
	},

	detectTizenSDK: function(logger, next){
		//Detect Tizen SDK
		//check OS, this code supporting windows only(for now useing registry to find path)
		// read key HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders
		// key "Local AppData" has path e.g. "C:\Users\aod\AppData\Local\tizen-sdk-data\tizensdkpathirst line from it 
		//"C:\Users\aod\AppData\Local\tizen-sdk-data\tizensdkpath
		var keyvalue = null;
		var reg = require('child_process');
		var self = this;
		reg.exec(
			'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" -v "Local AppData"', 
			function (err, stdout, stderr) {

				if(stdout !== null && (typeof stdout != 'undefined')){
					var arr = stdout.split(" ");
					keyvalue = arr[arr.length-1];//last parameter is path
					keyvalue = keyvalue.slice(0, -4);
					keyvalue = keyvalue + '\\tizen-sdk-data\\tizensdkpath';
					logger.info(__('reading file: ' + keyvalue));
					fs.readFile(keyvalue, 'utf8', function (err,data) {
						if (err) {
							logger.info(err);
							return;
						}
						var arr = data.split("=");
						self.tizenSdkDir =  arr[1];
						logger.info("Tizen SDK found at: " + self.tizenSdkDir);
						next(null, 'ok');
					});
				}else{
					logger.error('Error while looking for installed Tizen SDK. Cannot read values from windows registry');
				}
			});
	},

	find7za: function(logger){	
		var zippath = path.normalize(path.join(path.dirname(require.resolve('node-appc')), '..','tools','7zip','7za.exe'));
		if(fs.existsSync(zippath)){
			return zippath;
		}else{
			logger.error('7za.exe not found. Expected path: ' + path.normalize(zippath));
		}
	},

	signTizenApp: function(logger, callback){
		logger.info(__('signing application in  "%s" ', this.buildDir));
		var packer = require('child_process');
		var cmdSign = 'java -jar ' + path.join(this.mobilewebSdkPath, 'utils', 'signapp.jar') + ' -sig_proj ' +this.buildDir;
		logger.info(__('Signer commandline:  "%s" ', cmdSign));
		packer.exec(
			cmdSign,
			function (err, stdout, stderr) {				
				if(err != null){
					logger.error('Signing failed ');
					logger.error(stderr);
				}
				callback();
			});
	}
};

function badInstall(msg) {
	logger.error(msg + '\n');
	logger.log(__("Your SDK installation may be corrupt. You can reinstall it by running '%s'.", (cli.argv.$ + ' sdk update --force --default').cyan) + '\n');
	process.exit(1);
}

function applyDefaults(dest, src) {
	Object.keys(src).forEach(function (key) {
		if (dest.hasOwnProperty(key)) {
			if (Object.prototype.toString.call(dest[key]) == '[object Object]') {
				applyDefaults(dest[key], src[key]);
			}
		} else {
			if (Object.prototype.toString.call(src[key]) == '[object Object]') {
				dest[key] = {};
				applyDefaults(dest[key], src[key]);
			} else {
				dest[key] = src[key];
			}
		}
	});
}

function renderTemplate(template, props) {
	return template.replace(/\$\{([^\:\}]+)(?:\:([^\s\:\}]+))?\}/g, function (match, key, format) {
		var parts = key.trim().split('|').map(function (s) { return s.trim(); });
		key = parts[0];
		var value = '' + (props.hasOwnProperty(key) ? props[key] : 'null');
		if (parts.length > 1) {
			parts[1].split(',').forEach(function (cmd) {
				if (cmd == 'h') {
					value = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
				} else if (cmd == 'trim') {
					value = value.trim();
				} else if (cmd == 'jsQuoteEscapeFilter') {
					value = value.replace(/"/g, '\\"').replace(/\n/g, '\\n');
				}
			});
		}
		return value;
	});
}

function randomString(length) {
    var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz'.split('');

    if (! length) {
        length = Math.floor(Math.random() * chars.length);
    }

    var str = '';
    for (var i = 0; i < length; i++) {
        str += chars[Math.floor(Math.random() * chars.length)];
    }
    return str;
}