'use strict';

var async = require('async');
var cleancss = require('clean-css');
var exec = require('child_process').exec;
var findit = require('findit');
var fs = require('fs');
var jade = require('jade');
var marked = require('marked');
var mkdirp = require('mkdirp');
var path = require('path');
var uglifyjs = require('uglify-js');
var util = require('util');
var _ = require('./share/iterhate');

var styledocco = require('./styledocco');

var version = require('./package').version;

marked.setOptions({ sanitize: false, gfm: true });

var mincss = cleancss.process;
var minjs = uglifyjs;

// Get a filename without the extension
var baseFilename = function(str) {
  return path.basename(str, path.extname(str)).replace(/^_/, '');
};

// Get a pathname relative to the basePath, without the extension
var basePathname = function(file, basePath) {
  return path.join(
    path.dirname(path.relative(basePath, file) || path.basename(basePath)),
    baseFilename(file)
  );
};

// Build an HTML file name, named by it's path relative to basePath
var htmlFilename = function(file, basePath) {
  return path.join(
    path.dirname(path.relative(basePath, file) || path.basename(basePath)),
    baseFilename(file) + '.html'
  ).replace(/[\\/]/g, '-');
};

// Find first file matching `re` in `dir`.
var findFile = function(dir, re, cb) {
  fs.stat(dir, function(err, stat) {
    var files = fs.readdir(dir, function(err, files) {
      files = files.sort().filter(function(file) { return file.match(re); });
      if (!files.length) cb(new Error('No file found.'));
      else cb(null, path.join(dir, files[0]));
    });
  });
};

var getFiles = function(inPath, cb) {
  fs.stat(inPath, function(err, stat) {
    if (err != null) return cb(err);
    if (stat.isFile()) {
      cb(null, [ inPath ]);
    } else {
      var finder = findit.find(inPath);
      var files = [];
      finder.on('file', function(file) { files.push(file); });
      finder.on('end', function() { cb(null, files); });
    }
  });
};

// Make `link` objects for the menu.
var menuLinks = function(files, basePath) {
  return files.map(function(file) {
    var parts = path.relative(basePath, file).split('/');
    parts.pop(); // Remove filename
    return {
      name: baseFilename(file),
      href: htmlFilename(file, basePath),
      directory: parts[parts.length-1] || './'
    };
  })
  .reduce(function(links, link) {
    if (links[link.directory] != null) {
      links[link.directory].push(link);
    } else {
      links[link.directory] = [ link ];
    }
    return links;
  }, {});
};

var preprocess = function(file, pp, options, cb) {
  // stdin would have been nice here, but not all preprocessors (less)
  // accepts that, so we need to read the file both here and for the parser.
  // Don't process SASS partials.
  if (file.match(/(^|\/)_.*\.s(c|s)ss$/) != null) {
    process.nextTick(function() { cb(null, ''); });
  } else if (pp != null) {
    exec(pp + ' ' + file, function(err, stdout, stderr) {
      console.log(stderr);
      // log('styledocco: preprocessing ' + file + ' with ' + pp);
      // Fail gracefully on preprocessor errors
      if (err != null && options.verbose) console.error(err.message);
      if (stderr.length && options.verbose) console.error(stderr);
      cb(null, stdout || '');
    });
  } else {
    fs.readFile(file, 'utf8', cb);
  }
};


var cli = function(options) {

  var resourcesDir = __dirname + '/lib/';

  // Filetypes and matching preprocessor binaries.
  var fileTypes = {
    '.css': null,
    '.sass': 'sass',
    '.scss': 'scss',
    '.less': 'lessc',
    '.styl': 'stylus'
  };

  var log = options.verbose ? function(str) { console.log(str); }
                            : function() {};

  // Custom error also outputing StyleDocco and Node versions.
  var SDError = function(msg, err) {
    this.message = msg + '\n' + err.message + '\n' +
      'StyleDocco v' + version +
      ' running on Node ' + process.version + ' ' + process.platform;
    if (options.verbose) {
      this.message += '\nOptions: ' + JSON.stringify(options);
    }
  };
  util.inherits(SDError, Error);

  mkdirp(options.out);

  // Fetch all static resources.
  async.parallel({
    template: function(cb) {
      fs.readFile(resourcesDir + 'docs.jade', 'utf8', function(err, contents) {
        if (err != null) return cb(err);
        cb(null, jade.compile(contents, { filename: resourcesDir + 'docs.jade' }));
      });
    },
    // Extra JavaScript and CSS files to include in previews.
    previews: function(cb) {
      var code = { js: '', css: '' };
      var files = options.include.filter(function(file) {
        return _(['.css', '.js']).include(path.extname(file));
      });
      async.filter(files, path.exists, function(files) {
        async.reduce(files, code, function(tot, cur, cb) {
          fs.readFile(cur, 'utf8', function(err, contents) {
            if (err != null) return cb(err);
            tot[path.extname(cur).slice(1)] += contents;
            cb(null, tot);
          });
        }, cb);
      });
    },
    // Find input files.
    files: function(cb) {
      async.reduce(options['in'], [], function(all, cur, cb) {
        getFiles(cur, function(err, files) {
          if (err != null) return cb(err);
          cb(null, all.concat(files));
        });
      }, function(err, files) {
        if (err != null) return cb(err);
        files = files.filter(function(file) {
          // No hidden files
          if (file.match(/(\/|^)\.[^\.\/]/)) return false;
          // Only supported file types
          if (!(path.extname(file) in fileTypes)) return false;
          return true;
        }).sort();
        if (!files.length) cb(new Error('Failed to process files.'));
        cb(null, files);
      });
    },
    // Look for a README file.
    readme: function(cb) {
      findFile(options.basePath, /^readme\.m(ark)?d(own)?/i, function(err, file) {
        if (file != null && err == null) return read(file);
        findFile(process.cwd(), /^readme\.m(ark)?d(own)?/i, function(err, file) {
          if (err != null) file = resourcesDir + 'README.md';
          read(file);
        });
      });
      var read = function(file) {
        fs.readFile(file, 'utf8', function(err, content) {
          if (err != null) cb(err);
          cb(null, content);
        });
      };
    }
  }, function(err, resources) {
    if (err != null) throw new SDError('Could not process files.', err);
    var menu = menuLinks(resources.files, options.basePath);
    // Run files through preprocessor and StyleDocco parser.
    async.map(resources.files, function(file, cb) {
      async.parallel({
        css: async.apply(preprocess, file,
               options.preprocessor || fileTypes[path.extname(file)], options),
        docs: function(cb) {
          fs.readFile(file, 'utf8', function(err, code) {
            if (err != null) return cb(err);
            cb(null, styledocco(code));
          });
        }
      }, function(err, data) {
        if (err != null) return cb(err);
        data.path = file;
        cb(null, data);
      });
    }, function(err, files) {
      if (err != null) throw err;
      // Get the combined CSS from all files.
      var previewsStyles = mincss(
        _(files).pluck('css').join('') + resources.previews.css
      );
      // Build a JSON string of all files and their headings, for client side search.
      var searchIndex = JSON.stringify(
        _(files)
          .map(function(file) {
            return [{ title: baseFilename(file.path),
                      filename: basePathname(file.path, options.basePath),
                      url: htmlFilename(file.path, options.basePath) }]
              .concat(file.docs.map(function(section) {
                return { title: section.title,
                         filename: basePathname(file.path, options.basePath),
                         url: htmlFilename(file.path, options.basePath) + '#' + section.slug };
              })
            );
          })
          .flatten()
      );
      var previewsScripts = minjs(resources.previews.js);
      // Render files
      var htmlFiles = files.map(function(file) {
        return {
          path: file.path,
          html: resources.template({
            title: baseFilename(file.path),
            sections: file.docs,
            project: { name: options.name, menu: menu },
            resources: {
              searchIndex: searchIndex,
              js: previewsScripts,
              css: previewsStyles
            }
          })
        };
      });
      // Add readme with "fake" index path.
      htmlFiles.push({
        path: path.join(options.basePath, 'index'),
        html: resources.template({
          title: '',
          sections: styledocco.makeSections([{ docs: resources.readme, code: '' }]),
          project: { name: options.name, menu: menu },
          resources: {
            searchIndex: searchIndex
          }
        })
      });
      // Write files to the output dir.
      htmlFiles.forEach(function(file) {
        var dest = path.join(options.out, htmlFilename(file.path, options.basePath));
        log('styledocco: writing ' + file.path + ' -> ' + dest);
        fs.writeFileSync(dest, file.html);
      });
    });
  });
};

module.exports = cli;
module.exports.htmlFilename = htmlFilename;
module.exports.menuLinks = menuLinks;
