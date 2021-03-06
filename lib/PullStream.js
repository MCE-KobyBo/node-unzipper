var Stream = require('stream');
var Promise = require('bluebird');
var util = require('util');
var Buffer = require('buffer').Buffer;

// Backwards compatibility for node 0.8
if (!Stream.Writable)
  Stream = require('readable-stream');

function PullStream() {
  if (!(this instanceof PullStream))
    return new PullStream();

  Stream.Duplex.call(this,{decodeStrings:false, objectMode:true});
  this.buffer = new Buffer(''); 
  var self = this;
  self.on('finish',function() {
    self.finished = true;
    self.emit('chunk',false);
  });
}

util.inherits(PullStream,Stream.Duplex);

PullStream.prototype._write = function(chunk,e,cb) {
  this.buffer = Buffer.concat([this.buffer,chunk]);
  var oldcb = this.cb;
  this.cb = function() {
    if (oldcb)
      setImmediate(oldcb);
    setImmediate(cb);
  };
  this.emit('chunk');
};

PullStream.prototype.next = function() {
  if (this.cb) {
    this.cb();
    this.cb = undefined;
  }
  
  if (this.flushcb) {
    this.flushcb();
  }
};


// The `eof` parameter is interpreted as `file_length` if the type is number
// otherwise (i.e. buffer) it is interpreted as a pattern signaling end of stream
PullStream.prototype.stream = function(eof,includeEof) {
  var p = Stream.PassThrough();
  var count = 0,done,packet,self= this;

  function pull() {
    if (self.buffer && self.buffer.length) {
      if (typeof eof === 'number') {
        packet = self.buffer.slice(0,eof);
        self.buffer = self.buffer.slice(eof);
        eof -= packet.length;
        done = !eof;
      } else {
        var match = self.buffer.indexOf(eof);
        if (match !== -1) {
          if (includeEof) match = match + eof.length;
          packet = self.buffer.slice(0,match);
          self.buffer = self.buffer.slice(match);
          done = true;
        } else {
          var len = self.buffer.length - eof.length;
          packet = self.buffer.slice(0,len);
          self.buffer = self.buffer.slice(len);
        }
      }
      p.write(packet);
    }
    
    if (!done) {
      if (self.finished && !this.__ended) {
        self.removeListener('chunk',pull);
        p.emit('error','FILE_ENDED');
        this.__ended = true;
        return;
      }
      self.next();
    } else {
      self.removeListener('chunk',pull);
      if (!self.buffer.length)
        self.next();
      p.end();
    }
  }

  self.on('chunk',pull);
  pull();
  return p;
};

PullStream.prototype.pull = function(eof,includeEof) {
  var buffer = new Buffer(''),
      self = this;

  var concatStream = Stream.Transform();
  concatStream._transform = function(d,e,cb) {
    buffer = Buffer.concat([buffer,d]);
    cb();
  };
  
  return new Promise(function(resolve,reject) {
    if (self.finished)
      return reject('FILE_ENDED');
    self.stream(eof,includeEof)
      .on('error',reject)
      .pipe(concatStream)
      .on('finish',function() {resolve(buffer);})
      .on('error',reject);
  });
};

PullStream.prototype._read = function(){};

PullStream.prototype._flush = function(cb) {
  if (!this.buffer.length) 
    cb();
  else
    this.flushcb = cb;
};


module.exports = PullStream;
