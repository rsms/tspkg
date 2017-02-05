// version of gulp-babel with gulpFile in fileOpts
'use strict';
var path = require('path');
var gutil = require('gulp-util');
var through = require('through2');
var applySourceMap = require('vinyl-sourcemaps-apply');
var objectAssign = require('object-assign');
var replaceExt = require('replace-ext');
var babel = require('babel-core');

function replaceExtension(fp) {
  return path.extname(fp) ? replaceExt(fp, '.js') : fp;
}

module.exports = function (cfg, opts) {
  opts = opts || {};

  return through.obj(function (file, enc, cb) {
    if (file.isNull()) {
      cb(null, file);
      return;
    }

    if (file.isStream()) {
      cb(new gutil.PluginError('gulp-babel', 'Streaming not supported'));
      return;
    }

    let srcFilename = file.relative
    const sm = file.sourceMap
    if (sm && sm.sources && sm.sources[0]) {
      // assert(sm.sources.length == 1)
      srcFilename = sm.sources[0]
    }
    //console.log(`[gulp-babel] file.relative="${file.relative}", srcFilename="${srcFilename}"`)

    try {
      var fileOpts = objectAssign({}, opts, {
        filename: file.path,
        filenameRelative: file.relative,
        sourceMap: Boolean(file.sourceMap),
        sourceFileName: srcFilename
      });

      var res = babel.transform(file.contents.toString(), fileOpts);

      if (file.sourceMap && res.map) {
        res.map.file = replaceExtension(res.map.file);
        // console.log(
        //   `[gulp-babel] produced source map for ${file.relative}: ` +
        //   `res.map.sources[0]="${res.map.sources[0]}", ` +
        //   `file.sourceMap.sources[0]="${file.sourceMap.sources[0]}"`
        // )
        applySourceMap(file, res.map);
      }

      if (!res.ignored) {
        file.contents = new Buffer(res.code);
        file.path = replaceExtension(file.path);
      }

      file.babel = res.metadata

      this.push(file);
    } catch (err) {
      this.emit('error', new gutil.PluginError('gulp-babel', err, {
        fileName: file.path,
        showProperties: false
      }));
    }

    cb();
  });
};
