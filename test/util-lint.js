"use strict";

var fs = require("fs"), path = require("path"), tern = require("tern"), assert = require('assert');
require("tern-lint");
require("../browser-extension");

var projectDir = path.resolve(__dirname, "..");
var resolve = function(pth) {
  return path.resolve(projectDir, pth);
};
var browser = JSON.parse(fs
    .readFileSync(resolve("node_modules/tern/defs/browser.json")), "utf8");
var ecma5 = JSON.parse(fs
    .readFileSync(resolve("node_modules/tern/defs/ecma5.json")), "utf8");

var allDefs = {
  browser : browser,
  ecma5 : ecma5
};

var createServer = exports.createServer = function(defNames, options) {
  var defs = [];
  if (defNames) {
    for (var i = 0; i < defNames.length; i++) {
      var def = allDefs[defNames[i]];
      defs.push(def);
    }
  }
  var plugins = {
    "lint" : options ? options : {},
    "browser-extension": {}
  };
  var server = new tern.Server({
    plugins : plugins,
    defs : defs
  });
  return server;
}

var assertLintReponse = exports.assertLintReponse = function(err, resp, expected) {
  if (err)
    throw err;
  var actualMessages = resp.messages;
  var expectedMessages = expected.messages;
  assert.equal(JSON.stringify(resp), JSON.stringify(expected));
}

exports.assertLint = function(text, expected, defNames, options) {
  var server = createServer(defNames, options);
  server.addFile("test1.html", text);
  server.request({
    query : {
      type : "lint",
      file : "test1.html"
    }
  }, function(err, resp) {
    assertLintReponse(err, resp, expected);
  });
}