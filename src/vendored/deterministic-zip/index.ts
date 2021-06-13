/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/explicit-module-boundary-types */
"use strict";

import * as fs from "fs";
import * as path from "path";
import * as async from "async";
import { DeflateCRC32Stream } from "crc32-stream";
import * as minimatch from "minimatch";

const shouldInclude2 = (file, options) => {
  const include = options.includes.find((pattern) =>
    minimatch(file, pattern, { matchBase: true }),
  );
  if (include) {
    const exclude = options.excludes.find((pattern) =>
      minimatch(file, pattern, { matchBase: true }),
    );
    return include && !exclude;
  } else {
    return false;
  }
};

const addDir = (list, options, dir, callback) => {
  fs.readdir(dir, (err, files) => {
    const dirs: string[] = [];
    if (err) return callback(err);
    files.forEach((elem) => {
      const file = dir + "/" + elem;
      const info: any = fs.statSync(file); // would be better to rework this a bit but just marking any for now
      info.relativePath = path.relative(options.cwd, file);
      const check = info.isDirectory()
        ? "./" + info.relativePath + "/"
        : "./" + info.relativePath;
      if (shouldInclude2(check, options)) {
        info.filename = elem;
        info.absolutePath = path.resolve(file);
        list.push(info);
      }
      if (info.isDirectory()) {
        dirs.push(file);
      }
    });
    async.each(dirs, async.apply(addDir, list, options), callback);
  });
};

const getFiles = (dir, options, callback) => {
  const files = [];
  addDir(files, options, dir, (err) => {
    callback(undefined, files);
  });
};

const initFileHeaderTempl = () => {
  const headerTempl = Buffer.alloc(30, 0);
  headerTempl.writeInt32LE(0x04034b50, 0); //signature
  headerTempl.writeInt16LE(20, 4); //extractVersion
  headerTempl.writeInt16LE(0x808, 6); //bitflag (Data Descriptor + UTF8)
  headerTempl.writeInt16LE(8, 8); //compressionType
  headerTempl.writeInt16LE(0x6020, 10); //ModTime 12:01pm
  headerTempl.writeInt16LE(0x21, 12); //ModDate 1980/1/1
  return headerTempl;
};

const initFileCentralDirTempl = () => {
  // This was informative for figuring out how to update the values:
  // https://unix.stackexchange.com/questions/591686/change-permissions-on-a-file-in-a-zip-without-unzipping
  const directoryHeader = Buffer.alloc(46, 0);
  directoryHeader.writeInt32LE(0x02014b50, 0); //signature
  // directoryHeader.writeInt16LE(20, 4 ); //createdVersion
  // directoryHeader.writeInt16LE(3, 5 ); //created OS (Unix, for permissions)
  directoryHeader.writeInt16LE(20, 6); //extractVersion
  directoryHeader.writeInt16LE(0x808, 8); //bitflag (Data Descriptor + UTF8)
  directoryHeader.writeInt16LE(8, 10); //compressionType
  directoryHeader.writeInt16LE(0x6020, 12); //ModTime 12:01pm
  directoryHeader.writeInt16LE(0x21, 14); //ModDate 1980/1/1
  // directoryHeader.writeInt32BE(0x2481, 38); //External file attributes (permissions, a+r)
  return directoryHeader;
};

class Zipfile {
  directoryOffset: number;
  index: number;
  fileObjects: any[];
  outputStream: fs.WriteStream;
  fileheaderTempl: Buffer;
  fileCentralDirTempl: Buffer;
  numberOfFiles: number;

  constructor(files, zipfile) {
    this.index = 0;
    files.sort((a, b) => {
      return a.relativePath.localeCompare(b.relativePath);
    });
    this.fileObjects = files;
    this.outputStream = fs.createWriteStream(zipfile);
    this.fileheaderTempl = initFileHeaderTempl();
    this.fileCentralDirTempl = initFileCentralDirTempl();
    this.numberOfFiles = 0;
  }

  _write(buffer, callback) {
    this.index += buffer.length;
    this.outputStream.write(buffer, callback);
  }

  _getHeaderBuffers(file) {
    const headerTempl = this.fileheaderTempl;
    const filenameBuffer = Buffer.from(file.relativePath, "utf8");
    headerTempl.writeInt16LE(filenameBuffer.length, 26);
    return [headerTempl, filenameBuffer];
  }

  _writeFileHeader(file, callback) {
    const fileheaderBuffers = this._getHeaderBuffers(file);
    async.eachSeries(
      fileheaderBuffers,
      (buffer, cb) => {
        this._write(buffer, cb);
      },
      callback,
    );
  }

  _writeDataDescriptor(file, callback) {
    const dataDescriptor = Buffer.alloc(16, 0);
    dataDescriptor.writeInt32LE(0x08074b50, 0); //signature
    dataDescriptor.writeUIntLE(file.checksum, 4, 4); //crc-32
    dataDescriptor.writeInt32LE(file.compressedSize, 8); //compressed size
    dataDescriptor.writeInt32LE(file.uncompressedSize, 12); //uncompressed size
    this._write(dataDescriptor, callback);
  }

  _writeEntry(file, callback) {
    file.headerOffset = this.index;
    if (file.isFile()) {
      this.numberOfFiles++;
      this._writeFileHeader(file, (err) => {
        if (err) return callback(err);
        const readStream = fs.createReadStream(file.absolutePath);
        const checksum = new DeflateCRC32Stream();
        checksum.on("end", () => {
          file.checksum = checksum.digest();
          file.uncompressedSize = checksum.size();
          file.compressedSize = checksum.size(true);
          this.index += checksum.size(true); //add uncompressed size to index
          this._writeDataDescriptor(file, callback);
        });
        readStream.pipe(checksum).pipe(this.outputStream, { end: false });
      });
    } else {
      return callback();
    }
  }

  _writeDirectoryEntry(file, callback) {
    if (file.isDirectory()) {
      return callback();
    } else {
      const directoryTempl = this.fileCentralDirTempl;
      const filenameBuffer = Buffer.from(file.relativePath, "utf8");
      // https://github.com/bitgenics/deterministic-zip/pull/14
      // directoryTempl.writeUIntLE(file.checksum, 16, 4); //crc-32
      directoryTempl.writeUIntLE(
        parseInt(file.checksum.toString("hex"), 16),
        16,
        4,
      ); //crc-32
      directoryTempl.writeInt32LE(file.compressedSize, 20); //compressedSize
      directoryTempl.writeInt32LE(file.uncompressedSize, 24); //uncompressedSize
      directoryTempl.writeInt16LE(filenameBuffer.length, 28); //filename length
      directoryTempl.writeInt32LE(file.headerOffset, 42);
      const buffers = [directoryTempl, filenameBuffer];
      async.eachSeries(
        buffers,
        (buffer, cb) => {
          this._write(buffer, cb);
        },
        callback,
      );
    }
  }

  _writeEndRecord(callback) {
    const directorySize = this.index - this.directoryOffset;
    const endRecord = Buffer.alloc(22, 0);
    endRecord.writeInt32LE(0x06054b50, 0);
    endRecord.writeInt16LE(this.numberOfFiles, 8); //entries on disk
    endRecord.writeInt16LE(this.numberOfFiles, 10); //total entries
    endRecord.writeInt32LE(directorySize, 12); //size directory
    endRecord.writeInt32LE(this.directoryOffset, 16); //directory offset
    this._write(endRecord, callback);
  }

  zip(callback) {
    async.eachSeries(
      this.fileObjects,
      (file, cb) => {
        this._writeEntry(file, cb);
      },
      (err) => {
        this.directoryOffset = this.index;
        async.eachSeries(
          this.fileObjects,
          (file, cb) => {
            this._writeDirectoryEntry(file, cb);
          },
          (err) => {
            this._writeEndRecord((err) => {
              this.outputStream.close();
              callback();
            });
          },
        );
      },
    );
  }
}

export function zip(dir, destination, options, callback) {
  if (callback === undefined) {
    callback = options;
    options = {};
  }
  options.includes = options.includes || ["./**"];
  options.excludes = options.excludes || [
    ".git",
    "CVS",
    ".svn",
    ".hg",
    ".lock-wscript",
    ".wafpickle-N",
    "*.swp",
    ".DS_Store",
    "._*",
    "npm-debug.log",
  ];
  options.cwd = options.cwd || ".";
  getFiles(dir, options, (err, files) => {
    const zipfile = new Zipfile(files, destination);
    zipfile.zip(callback);
  });
}
