'use strict';

var through = require('through2');
var path = require('path');
var File = require('vinyl');
var Concat = require('concat-with-sourcemaps');

// file can be a vinyl file object or a string
// when a string it will construct a new one
module.exports = function(file, opt) {
  if (!file) {
    throw new Error('gulp-concat: Missing file option');
  }
  opt = opt || {};

  // to preserve existing |undefined| behaviour and to introduce |separator: ""| for binaries
  if (typeof opt.separator !== 'string') {
    opt.separator = '\n';
  }

  var isUsingSourceMaps = false;
  var latestFile;
  var latestMod;
  var fileName;
  var concat;

  if (typeof file === 'string') {
    fileName = file;
  } else if (typeof file.path === 'string') {
    fileName = path.basename(file.path);
  } else {
    throw new Error('gulp-concat: Missing path in file options');
  }

  function addExtra(concat, extra) {
    if (extra) {
      if (typeof extra == 'string') {
        concat.add(null, extra);
      } else if (extra.relative !== undefined &&
                 extra.contents !== undefined)
      {
        concat.add(extra.relative, extra.contents, extra.sourceMap);
      } else {
        throw new Error(
          'unexpected value; expected string or vinyl-file like object'
        )
      }
    }
  }

  function bufferContents(file, enc, cb) {
    // ignore empty files
    if (file.isNull()) {
      cb();
      return;
    }

    // we don't do streams (yet)
    if (file.isStream()) {
      this.emit('error', new Error('gulp-concat: Streaming not supported'));
      cb();
      return;
    }

    // enable sourcemap support for concat
    // if a sourcemap initialized file comes in
    if (file.sourceMap && isUsingSourceMaps === false) {
      isUsingSourceMaps = true;
    }

    // set latest file if not already set,
    // or if the current file was modified more recently.
    if (!latestMod || file.stat && file.stat.mtime > latestMod) {
      latestFile = file;
      latestMod = file.stat && file.stat.mtime;
    }

    // construct concat instance
    if (!concat) {
      concat = new Concat(isUsingSourceMaps, fileName, opt.separator);
    }

    // add any leader to concat instance
    opt.beforeFile && addExtra(concat, opt.beforeFile(file));

    // add file to concat instance
    concat.add(file.relative, file.contents, file.sourceMap);

    // add any trailer to concat instance
    opt.afterFile && addExtra(concat, opt.afterFile(file));

    cb();
  }

  function endStream(cb) {

    // no files passed in, no file goes out
    if (!latestFile || !concat) {
      // console.log('concat: no file passed in, none goes out')
      cb();
      return;
    }

    var joinedFile;

    // if file opt was a file path
    // clone everything from the latest file
    if (typeof file === 'string') {
      joinedFile = latestFile.clone({contents: false});
      joinedFile.path = path.join(latestFile.base, file);
    } else {
      joinedFile = new File(file);
    }

    joinedFile.contents = concat.content;

    if (concat.sourceMapping) {
      joinedFile.sourceMap = JSON.parse(concat.sourceMap);
    }

    // console.log('concat: push joinedFile', joinedFile.relative,
    //             'of size', joinedFile.contents.length)

    this.push(joinedFile);
    cb();
  }

  return through.obj(bufferContents, endStream);
};
