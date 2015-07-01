(function(root, mod) {
    if (typeof exports == "object" && typeof module == "object") // CommonJS
      return mod(exports, require("tern/lib/infer"), require("tern/lib/tern"),
          require("acorn"), require("sax"), require("csslint").CSSLint);
    if (typeof define == "function" && define.amd) // AMD
        return define(["exports", "tern/lib/infer", "tern/lib/tern", "acorn/dist/acorn", "sax" ], mod);
    mod(root, tern, tern, acorn, sax, root.CSSLint ? root.CSSLint : null);
})(this, function(exports, infer, tern, acorn, sax, CSSLint) {
    "use strict";
  
  var htmlExtensions = {
    "htm": true,
    "html": true,
    "xhtml": true,
    "jsp": true,
    "jsf": true,
    "php": true
  }
  
  var defaultRules = {
    "UnknownElementId" : {"severity" : "warning"}
  };
  
  var startsWith = function (s, searchString, position) {
    position = position || 0;
    return s.indexOf(searchString, position) === position;
  };
  
  // DOM Document
    
  function isScriptTag(tagName) {
    return tagName.toLowerCase() == "script";
  }
  
  function isScriptEvent(attrName) {
    return startsWith(attrName, "on");
  }
  
  function spaces(text, from, to) {
    var spaces = "";
    for (var i = from; i < to; i++) {
      var c = text.charAt(i);
      switch(c) {
        case "\r":
        case "\n":
        case "\t":
          spaces += c;
          break;
        default:
          spaces += " ";
      }
    }
    return spaces;
  }
  
  var DOMDocument = exports.DOMDocument= function(xml, file) {
    var ids = this.ids = {};
    var scripts = "", scriptParsing = false, from = 0, to = xml.length, 
    parser = sax.parser(true);
    parser.onopentag = function (node) {
      if (isScriptTag(node.name)) {
        scriptParsing = true;
        to = this.position;          
        scripts = scripts + spaces(xml, from, to);
        from = to;
        to = xml.length;        
      }
    };
    parser.onclosetag = function (tagName) {
      if (isScriptTag(tagName)) {
        scriptParsing = false;
        to = this.position;
        var endElement = "</" + tagName + ">";
        scripts = scripts + xml.substring(from, to  - endElement.length);
        scripts = scripts + spaces(endElement, 0, endElement.length);
        from = to;
        to = xml.length;
      }
    };
    parser.onattribute = function (attr) {
      var startVal = this.position - attr.value.length - 1, endVal = this.position - 1; 
      if (attr.name.toLowerCase() == "id") {
        var originNode = new acorn.Node();
        originNode.start = startVal;
        originNode.end = endVal;
        originNode.sourceFile = file;
        originNode.ownerElement = this.tagName;
        ids[attr.value] = originNode;
      } else if (isScriptEvent(attr.name)) {
        scripts = scripts + spaces(xml, from, startVal);
        scripts = scripts + attr.value;
        from = this.position - 1;
        to =  xml.length;
      }
    };
    parser.write(xml);
    if (from != to) {
      if (scriptParsing) {
        scripts = scripts + xml.substring(from, to);
      } else {
        scripts = scripts + spaces(xml, from, to);
      }
    }
    this.scripts = scripts;
    
  }
  
  // Custom tern function
  
  function createElement(tagName) {
    if (!tagName || tagName.length < 1) return new infer.Obj(infer.def.parsePath("HTMLElement.prototype"));
    var cx = infer.cx(), server = cx.parent, name = 'HTML' + tagName.substring(0, 1).toUpperCase() + tagName.substring(1, tagName.length) + "Element", 
        locals = infer.def.parsePath(name + ".prototype");
    if (locals && locals != infer.ANull) return new infer.Obj(locals);    
    return createElement();
  }
  
  infer.registerFunction("Browser_getElementById", function(_self, args, argNodes) {
    if (!argNodes || !argNodes.length || argNodes[0].type != "Literal" || typeof argNodes[0].value != "string" || !(argNodes[0].sourceFile && argNodes[0].sourceFile.dom))
      return createElement();
    var cx = infer.cx(), id = argNodes[0].value, dom = argNodes[0].sourceFile.dom, attr = dom.ids[id];
    argNodes[0].elementId = true;
    if (attr) {
      argNodes[0].dom = attr;
      return createElement(attr.ownerElement);
    }
    return createElement();
  });
    
  infer.registerFunction("Browser_createElement", function(_self, args, argNodes) {
    if (!argNodes || !argNodes.length || argNodes[0].type != "Literal" || typeof argNodes[0].value != "string")
      return createElement();
    return createElement(argNodes[0].value);
  });
  
  infer.registerFunction("Browser_querySelector", function(_self, args, argNodes) {
    if (!argNodes || !argNodes.length || argNodes[0].type != "Literal" || typeof argNodes[0].value != "string" || !(argNodes[0].sourceFile && argNodes[0].sourceFile.dom)) {
      return
    }    
    argNodes[0].cssselectors = true;
  });
  
  // Plugin
  
  tern.registerPlugin("browser-extension", function(server, options) {
    registerLints();
    return {passes: {
             preLoadDef: preLoadDef,
             preParse: preParse,             
             typeAt: findTypeAt,
             completion: findCompletions
           }};
  });
  
  // Lint
  
  function registerLints() {
    if (!tern.registerLint) return;

    // validate document.getElementById
    tern.registerLint("Browser_validateElementId", function(node, addMessage, getRule) {
      var argNode = node.arguments[0];
      if (argNode && !argNode.dom) {
        addMessage(argNode, "Unknown element id '" + argNode.value + "'", defaultRules.UnknownElementId.severity);
      }
    });
    
    // validate Element#querySelector/Element#queryAllSelector
    tern.registerLint("Browser_validateCSSSelectors", function(node, addMessage, getRule) {
      var argNode = node.arguments[0];
      if (!argNode || argNode.type != "Literal" || typeof argNode.value != "string") {       
        return;
      }
      if (!CSSLint) return;
      var rule = getRule("InvalidArgument");
      if (!rule) return;
      var result = CSSLint.verify(argNode.value + "{}", { ids: 0});
      if (result && result.messages.length > 0) {
        for (var i = 0; i < result.messages.length; i++) {
          var message = result.messages[i], startCol = message.col -1, endCol = message.col;
          var n = {start: argNode.start + startCol, end: argNode.start + endCol}
          addMessage(n, "Invalid CSS selectors '" + argNode.value + "': " + message.message, rule.severity, startCol, endCol);          
        }
      }
    });
    
  }
  
  // Pre load def : implementation to override getElementById an dcreateElement !type
  
  function preLoadDef(data) {    
    var cx = infer.cx();
    if (data["!name"] == "browser") {
      // Override Document#getElementById !type
      var getElementById = data["Document"]["prototype"]["getElementById"];
      getElementById["!type"] = "fn(id: string) -> !custom:Browser_getElementById";
      getElementById["!data"] = {"!lint": "Browser_validateElementId"};
      // Override Document#createElement !type
      var createElement = data["Document"]["prototype"]["createElement"];
      createElement["!type"] = "fn(tagName: string) -> !custom:Browser_createElement";
      // Add Element#querySelector !effects
      var querySelector = data["Element"]["prototype"]["querySelector"];
      querySelector["!effects"] = ["custom Browser_querySelector"];
      querySelector["!data"] =  {"!lint": "Browser_validateCSSSelectors"};
      // Add Element#querySelector !effects
      var querySelectorAll = data["Element"]["prototype"]["querySelectorAll"];
      querySelectorAll["!effects"] = ["custom Browser_querySelector"];
      querySelectorAll["!data"] =  {"!lint": "Browser_validateCSSSelectors"};        
    }
  }
  
  // Pre parse
  
  function isHTML(file) {
    var name = file.name; 
    if (name == "[doc]") return true;
    var index = name.lastIndexOf(".");
    return index != -1 && htmlExtensions[name.substring(index + 1, name.length)] == true;
  }
  
  function preParse(text, options) {
    var file = options.directSourceFile;
    if (!isHTML(file)) return;
    var dom = file.dom = new DOMDocument(text, file);          
    return dom.scripts;
  }

  // Find type at
  
  function findTypeAt(_file, _pos, expr, type) {
    if (!expr) return type;
    var isStringLiteral = expr.node.type === "Literal" &&
       typeof expr.node.value === "string";
    var isDOMArg = !!expr.node.dom;

    if (isStringLiteral && isDOMArg) {
      // The `type` is a value shared for all string literals.
      // We must create a copy before modifying `origin` and `originNode`.
      // Otherwise all string literals would point to the last jump location
      type = Object.create(type);
      type.origin = expr.node.dom.sourceFile.name; 
      type.originNode = expr.node.dom;
    }

    return type;
  }

  // Find completion
  
  function findCompletions(file, query) {
    var wordEnd = tern.resolvePos(file, query.end);
    var callExpr = infer.findExpressionAround(file.ast, null, wordEnd, file.scope, "CallExpression");
    if (!callExpr) return;
    var callNode = callExpr.node;
    if (!callNode.callee.object || /* callNode.callee.object.name != "document" ||*/
        callNode.callee.type != "MemberExpression" || !callNode.callee.property || /* callNode.callee.property.name != "getElementById" ||*/
        callNode.arguments.length < 1) return;
    // here completion for document.getElementById('Ctrl+Space'
    var argNode = findAttrValue(callNode.arguments, wordEnd);
    if (!argNode || (!argNode.elementId)) return;
    var word = argNode.raw.slice(1, wordEnd - argNode.start), quote = argNode.raw.charAt(0);
    if (word && word.charAt(word.length - 1) == quote)
      word = word.slice(0, word.length - 1);
    var completions = completeAttrValue(query, file, word);
    if (argNode.end == wordEnd + 1 && file.text.charAt(wordEnd) == quote)
      ++wordEnd;
    return {
      start: tern.outputPos(query, file, argNode.start),
      end: tern.outputPos(query, file, wordEnd),
      isProperty: false,
      isObjectKey: false,
      completions: completions.map(function(rec) {
        var name = typeof rec == "string" ? rec : rec.name;
        var string = JSON.stringify(name);
        if (quote == "'") string = quote + string.slice(1, string.length -1).replace(/'/g, "\\'") + quote;
        if (typeof rec == "string") return string;
        rec.displayName = name;
        rec.name = string;
        return rec;
      })
    };
  }
  
  function findAttrValue(argsNode, wordEnd) {
    for (var i = 0; i < argsNode.length; i++) {
      var argNode = argsNode[i];
      if (argNode.type == "Literal" && typeof argNode.value == "string" &&
          argNode.start < wordEnd && argNode.end > wordEnd) return argNode;
    }
  }
  
  function completeAttrValue(query, file, word) {
    var completions = [];
    var cx = infer.cx(), server = cx.parent, dom = file.dom, attrs = dom ? dom.ids : null;
    if (!attrs) return completions;
    var wrapAsObjs = query.types || query.depths || query.docs || query.urls || query.origins;

    function maybeSet(obj, prop, val) {
      if (val != null) obj[prop] = val;
    }
    
    function gather(attrs) {
      for (var name in attrs) {
        if (name &&
            !(query.filter !== false && word &&
              (query.caseInsensitive ? name.toLowerCase() : name).indexOf(word) !== 0)) {
          var rec = wrapAsObjs ? {name: name} : name;
          completions.push(rec);

          if (query.types || query.origins) {         
            if (query.types) rec.type = "Attr";
            if (query.origins)
              maybeSet(rec, "origin", file.name);
          }
        }
      }
    }

    if (query.caseInsensitive) word = word.toLowerCase();
    gather(attrs);
    return completions;
  }
  
})