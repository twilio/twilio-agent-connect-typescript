import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';
import twilio from 'twilio';
import { WebSocket } from 'ws';
import VoiceResponse2 from 'twilio/lib/twiml/VoiceResponse.js';

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  __defProp(target, "default", { value: mod, enumerable: true }) ,
  mod
));

// ../../node_modules/dotenv/package.json
var require_package = __commonJS({
  "../../node_modules/dotenv/package.json"(exports$1, module) {
    module.exports = {
      name: "dotenv",
      version: "16.6.1",
      description: "Loads environment variables from .env file",
      main: "lib/main.js",
      types: "lib/main.d.ts",
      exports: {
        ".": {
          types: "./lib/main.d.ts",
          require: "./lib/main.js",
          default: "./lib/main.js"
        },
        "./config": "./config.js",
        "./config.js": "./config.js",
        "./lib/env-options": "./lib/env-options.js",
        "./lib/env-options.js": "./lib/env-options.js",
        "./lib/cli-options": "./lib/cli-options.js",
        "./lib/cli-options.js": "./lib/cli-options.js",
        "./package.json": "./package.json"
      },
      scripts: {
        "dts-check": "tsc --project tests/types/tsconfig.json",
        lint: "standard",
        pretest: "npm run lint && npm run dts-check",
        test: "tap run --allow-empty-coverage --disable-coverage --timeout=60000",
        "test:coverage": "tap run --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
        prerelease: "npm test",
        release: "standard-version"
      },
      repository: {
        type: "git",
        url: "git://github.com/motdotla/dotenv.git"
      },
      homepage: "https://github.com/motdotla/dotenv#readme",
      funding: "https://dotenvx.com",
      keywords: [
        "dotenv",
        "env",
        ".env",
        "environment",
        "variables",
        "config",
        "settings"
      ],
      readmeFilename: "README.md",
      license: "BSD-2-Clause",
      devDependencies: {
        "@types/node": "^18.11.3",
        decache: "^4.6.2",
        sinon: "^14.0.1",
        standard: "^17.0.0",
        "standard-version": "^9.5.0",
        tap: "^19.2.0",
        typescript: "^4.8.4"
      },
      engines: {
        node: ">=12"
      },
      browser: {
        fs: false
      }
    };
  }
});

// ../../node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "../../node_modules/dotenv/lib/main.js"(exports$1, module) {
    var fs = __require("fs");
    var path = __require("path");
    var os = __require("os");
    var crypto = __require("crypto");
    var packageJson = require_package();
    var version = packageJson.version;
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.log(`[dotenv@${version}][WARN] ${message}`);
    }
    function _debug(message) {
      console.log(`[dotenv@${version}][DEBUG] ${message}`);
    }
    function _log(message) {
      console.log(`[dotenv@${version}] ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path.resolve(process.cwd(), ".env.vault");
      }
      if (fs.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (debug || !quiet) {
        _log("Loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("No encoding is specified. UTF-8 is used by default");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path2 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs.readFileSync(path2, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path2} ${e.message}`);
          }
          lastError = e;
        }
      }
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsedAll, options);
      if (debug || !quiet) {
        const keysCount = Object.keys(parsedAll).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`Failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injecting env (${keysCount}) from ${shortPaths.join(",")}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config2(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
        }
      }
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config: config2,
      decrypt,
      parse,
      populate
    };
    module.exports.configDotenv = DotenvModule.configDotenv;
    module.exports._configVault = DotenvModule._configVault;
    module.exports._parseVault = DotenvModule._parseVault;
    module.exports.config = DotenvModule.config;
    module.exports.decrypt = DotenvModule.decrypt;
    module.exports.parse = DotenvModule.parse;
    module.exports.populate = DotenvModule.populate;
    module.exports = DotenvModule;
  }
});

// ../../node_modules/pino-std-serializers/lib/err-helpers.js
var require_err_helpers = __commonJS({
  "../../node_modules/pino-std-serializers/lib/err-helpers.js"(exports$1, module) {
    var isErrorLike = (err) => {
      return err && typeof err.message === "string";
    };
    var getErrorCause = (err) => {
      if (!err) return;
      const cause = err.cause;
      if (typeof cause === "function") {
        const causeResult = err.cause();
        return isErrorLike(causeResult) ? causeResult : void 0;
      } else {
        return isErrorLike(cause) ? cause : void 0;
      }
    };
    var _stackWithCauses = (err, seen) => {
      if (!isErrorLike(err)) return "";
      const stack = err.stack || "";
      if (seen.has(err)) {
        return stack + "\ncauses have become circular...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        return stack + "\ncaused by: " + _stackWithCauses(cause, seen);
      } else {
        return stack;
      }
    };
    var stackWithCauses = (err) => _stackWithCauses(err, /* @__PURE__ */ new Set());
    var _messageWithCauses = (err, seen, skip) => {
      if (!isErrorLike(err)) return "";
      const message = skip ? "" : err.message || "";
      if (seen.has(err)) {
        return message + ": ...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        const skipIfVErrorStyleCause = typeof err.cause === "function";
        return message + (skipIfVErrorStyleCause ? "" : ": ") + _messageWithCauses(cause, seen, skipIfVErrorStyleCause);
      } else {
        return message;
      }
    };
    var messageWithCauses = (err) => _messageWithCauses(err, /* @__PURE__ */ new Set());
    module.exports = {
      isErrorLike,
      getErrorCause,
      stackWithCauses,
      messageWithCauses
    };
  }
});

// ../../node_modules/pino-std-serializers/lib/err-proto.js
var require_err_proto = __commonJS({
  "../../node_modules/pino-std-serializers/lib/err-proto.js"(exports$1, module) {
    var seen = /* @__PURE__ */ Symbol("circular-ref-tag");
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-err-ref");
    var pinoErrProto = Object.create({}, {
      type: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      message: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      stack: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      aggregateErrors: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoErrProto, rawSymbol, {
      writable: true,
      value: {}
    });
    module.exports = {
      pinoErrProto,
      pinoErrorSymbols: {
        seen,
        rawSymbol
      }
    };
  }
});

// ../../node_modules/pino-std-serializers/lib/err.js
var require_err = __commonJS({
  "../../node_modules/pino-std-serializers/lib/err.js"(exports$1, module) {
    module.exports = errSerializer;
    var { messageWithCauses, stackWithCauses, isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = messageWithCauses(err);
      _err.stack = stackWithCauses(err);
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errSerializer(err2));
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (key !== "cause" && !Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/pino-std-serializers/lib/err-with-cause.js
var require_err_with_cause = __commonJS({
  "../../node_modules/pino-std-serializers/lib/err-with-cause.js"(exports$1, module) {
    module.exports = errWithCauseSerializer;
    var { isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errWithCauseSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = err.message;
      _err.stack = err.stack;
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errWithCauseSerializer(err2));
      }
      if (isErrorLike(err.cause) && !Object.prototype.hasOwnProperty.call(err.cause, seen)) {
        _err.cause = errWithCauseSerializer(err.cause);
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (!Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errWithCauseSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/pino-std-serializers/lib/req.js
var require_req = __commonJS({
  "../../node_modules/pino-std-serializers/lib/req.js"(exports$1, module) {
    module.exports = {
      mapHttpRequest,
      reqSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-req-ref");
    var pinoReqProto = Object.create({}, {
      id: {
        enumerable: true,
        writable: true,
        value: ""
      },
      method: {
        enumerable: true,
        writable: true,
        value: ""
      },
      url: {
        enumerable: true,
        writable: true,
        value: ""
      },
      query: {
        enumerable: true,
        writable: true,
        value: ""
      },
      params: {
        enumerable: true,
        writable: true,
        value: ""
      },
      headers: {
        enumerable: true,
        writable: true,
        value: {}
      },
      remoteAddress: {
        enumerable: true,
        writable: true,
        value: ""
      },
      remotePort: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoReqProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function reqSerializer(req) {
      const connection = req.info || req.socket;
      const _req = Object.create(pinoReqProto);
      _req.id = typeof req.id === "function" ? req.id() : req.id || (req.info ? req.info.id : void 0);
      _req.method = req.method;
      if (req.originalUrl) {
        _req.url = req.originalUrl;
      } else {
        const path = req.path;
        _req.url = typeof path === "string" ? path : req.url ? req.url.path || req.url : void 0;
      }
      if (req.query) {
        _req.query = req.query;
      }
      if (req.params) {
        _req.params = req.params;
      }
      _req.headers = req.headers;
      _req.remoteAddress = connection && connection.remoteAddress;
      _req.remotePort = connection && connection.remotePort;
      _req.raw = req.raw || req;
      return _req;
    }
    function mapHttpRequest(req) {
      return {
        req: reqSerializer(req)
      };
    }
  }
});

// ../../node_modules/pino-std-serializers/lib/res.js
var require_res = __commonJS({
  "../../node_modules/pino-std-serializers/lib/res.js"(exports$1, module) {
    module.exports = {
      mapHttpResponse,
      resSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-res-ref");
    var pinoResProto = Object.create({}, {
      statusCode: {
        enumerable: true,
        writable: true,
        value: 0
      },
      headers: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoResProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function resSerializer(res) {
      const _res = Object.create(pinoResProto);
      _res.statusCode = res.headersSent ? res.statusCode : null;
      _res.headers = res.getHeaders ? res.getHeaders() : res._headers;
      _res.raw = res;
      return _res;
    }
    function mapHttpResponse(res) {
      return {
        res: resSerializer(res)
      };
    }
  }
});

// ../../node_modules/pino-std-serializers/index.js
var require_pino_std_serializers = __commonJS({
  "../../node_modules/pino-std-serializers/index.js"(exports$1, module) {
    var errSerializer = require_err();
    var errWithCauseSerializer = require_err_with_cause();
    var reqSerializers = require_req();
    var resSerializers = require_res();
    module.exports = {
      err: errSerializer,
      errWithCause: errWithCauseSerializer,
      mapHttpRequest: reqSerializers.mapHttpRequest,
      mapHttpResponse: resSerializers.mapHttpResponse,
      req: reqSerializers.reqSerializer,
      res: resSerializers.resSerializer,
      wrapErrorSerializer: function wrapErrorSerializer(customSerializer) {
        if (customSerializer === errSerializer) return customSerializer;
        return function wrapErrSerializer(err) {
          return customSerializer(errSerializer(err));
        };
      },
      wrapRequestSerializer: function wrapRequestSerializer(customSerializer) {
        if (customSerializer === reqSerializers.reqSerializer) return customSerializer;
        return function wrappedReqSerializer(req) {
          return customSerializer(reqSerializers.reqSerializer(req));
        };
      },
      wrapResponseSerializer: function wrapResponseSerializer(customSerializer) {
        if (customSerializer === resSerializers.resSerializer) return customSerializer;
        return function wrappedResSerializer(res) {
          return customSerializer(resSerializers.resSerializer(res));
        };
      }
    };
  }
});

// ../../node_modules/pino/lib/caller.js
var require_caller = __commonJS({
  "../../node_modules/pino/lib/caller.js"(exports$1, module) {
    function noOpPrepareStackTrace(_, stack) {
      return stack;
    }
    module.exports = function getCallers() {
      const originalPrepare = Error.prepareStackTrace;
      Error.prepareStackTrace = noOpPrepareStackTrace;
      const stack = new Error().stack;
      Error.prepareStackTrace = originalPrepare;
      if (!Array.isArray(stack)) {
        return void 0;
      }
      const entries = stack.slice(2);
      const fileNames = [];
      for (const entry of entries) {
        if (!entry) {
          continue;
        }
        fileNames.push(entry.getFileName());
      }
      return fileNames;
    };
  }
});

// ../../node_modules/@pinojs/redact/index.js
var require_redact = __commonJS({
  "../../node_modules/@pinojs/redact/index.js"(exports$1, module) {
    function deepClone(obj) {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      if (obj instanceof Date) {
        return new Date(obj.getTime());
      }
      if (obj instanceof Array) {
        const cloned = [];
        for (let i = 0; i < obj.length; i++) {
          cloned[i] = deepClone(obj[i]);
        }
        return cloned;
      }
      if (typeof obj === "object") {
        const cloned = Object.create(Object.getPrototypeOf(obj));
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
          }
        }
        return cloned;
      }
      return obj;
    }
    function parsePath(path) {
      const parts = [];
      let current = "";
      let inBrackets = false;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if (!inBrackets && char === ".") {
          if (current) {
            parts.push(current);
            current = "";
          }
        } else if (char === "[") {
          if (current) {
            parts.push(current);
            current = "";
          }
          inBrackets = true;
        } else if (char === "]" && inBrackets) {
          parts.push(current);
          current = "";
          inBrackets = false;
          inQuotes = false;
        } else if ((char === '"' || char === "'") && inBrackets) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          } else {
            current += char;
          }
        } else {
          current += char;
        }
      }
      if (current) {
        parts.push(current);
      }
      return parts;
    }
    function setValue(obj, parts, value) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = value;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              current[key] = value;
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          current[lastKey] = value;
        }
      }
      return true;
    }
    function removeKey(obj, parts) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = void 0;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              delete current[key];
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          delete current[lastKey];
        }
      }
      return true;
    }
    var PATH_NOT_FOUND = /* @__PURE__ */ Symbol("PATH_NOT_FOUND");
    function getValueIfExists(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return PATH_NOT_FOUND;
        }
        if (typeof current !== "object" || current === null) {
          return PATH_NOT_FOUND;
        }
        if (!(part in current)) {
          return PATH_NOT_FOUND;
        }
        current = current[part];
      }
      return current;
    }
    function getValue(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return void 0;
        }
        if (typeof current !== "object" || current === null) {
          return void 0;
        }
        current = current[part];
      }
      return current;
    }
    function redactPaths(obj, paths, censor, remove = false) {
      for (const path of paths) {
        const parts = parsePath(path);
        if (parts.includes("*")) {
          redactWildcardPath(obj, parts, censor, path, remove);
        } else {
          if (remove) {
            removeKey(obj, parts);
          } else {
            const value = getValueIfExists(obj, parts);
            if (value === PATH_NOT_FOUND) {
              continue;
            }
            const actualCensor = typeof censor === "function" ? censor(value, parts) : censor;
            setValue(obj, parts, actualCensor);
          }
        }
      }
    }
    function redactWildcardPath(obj, parts, censor, originalPath, remove = false) {
      const wildcardIndex = parts.indexOf("*");
      if (wildcardIndex === parts.length - 1) {
        const parentParts = parts.slice(0, -1);
        let current = obj;
        for (const part of parentParts) {
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
        }
        if (Array.isArray(current)) {
          if (remove) {
            for (let i = 0; i < current.length; i++) {
              current[i] = void 0;
            }
          } else {
            for (let i = 0; i < current.length; i++) {
              const indexPath = [...parentParts, i.toString()];
              const actualCensor = typeof censor === "function" ? censor(current[i], indexPath) : censor;
              current[i] = actualCensor;
            }
          }
        } else if (typeof current === "object" && current !== null) {
          if (remove) {
            const keysToDelete = [];
            for (const key in current) {
              if (Object.prototype.hasOwnProperty.call(current, key)) {
                keysToDelete.push(key);
              }
            }
            for (const key of keysToDelete) {
              delete current[key];
            }
          } else {
            for (const key in current) {
              const keyPath = [...parentParts, key];
              const actualCensor = typeof censor === "function" ? censor(current[key], keyPath) : censor;
              current[key] = actualCensor;
            }
          }
        }
      } else {
        redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove);
      }
    }
    function redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove = false) {
      const beforeWildcard = parts.slice(0, wildcardIndex);
      const afterWildcard = parts.slice(wildcardIndex + 1);
      const pathArray = [];
      function traverse(current, pathLength) {
        if (pathLength === beforeWildcard.length) {
          if (Array.isArray(current)) {
            for (let i = 0; i < current.length; i++) {
              pathArray[pathLength] = i.toString();
              traverse(current[i], pathLength + 1);
            }
          } else if (typeof current === "object" && current !== null) {
            for (const key in current) {
              pathArray[pathLength] = key;
              traverse(current[key], pathLength + 1);
            }
          }
        } else if (pathLength < beforeWildcard.length) {
          const nextKey = beforeWildcard[pathLength];
          if (current && typeof current === "object" && current !== null && nextKey in current) {
            pathArray[pathLength] = nextKey;
            traverse(current[nextKey], pathLength + 1);
          }
        } else {
          if (afterWildcard.includes("*")) {
            const wrappedCensor = typeof censor === "function" ? (value, path) => {
              const fullPath = [...pathArray.slice(0, pathLength), ...path];
              return censor(value, fullPath);
            } : censor;
            redactWildcardPath(current, afterWildcard, wrappedCensor, originalPath, remove);
          } else {
            if (remove) {
              removeKey(current, afterWildcard);
            } else {
              const actualCensor = typeof censor === "function" ? censor(getValue(current, afterWildcard), [...pathArray.slice(0, pathLength), ...afterWildcard]) : censor;
              setValue(current, afterWildcard, actualCensor);
            }
          }
        }
      }
      if (beforeWildcard.length === 0) {
        traverse(obj, 0);
      } else {
        let current = obj;
        for (let i = 0; i < beforeWildcard.length; i++) {
          const part = beforeWildcard[i];
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
          pathArray[i] = part;
        }
        if (current !== null && current !== void 0) {
          traverse(current, beforeWildcard.length);
        }
      }
    }
    function buildPathStructure(pathsToClone) {
      if (pathsToClone.length === 0) {
        return null;
      }
      const pathStructure = /* @__PURE__ */ new Map();
      for (const path of pathsToClone) {
        const parts = parsePath(path);
        let current = pathStructure;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!current.has(part)) {
            current.set(part, /* @__PURE__ */ new Map());
          }
          current = current.get(part);
        }
      }
      return pathStructure;
    }
    function selectiveClone(obj, pathStructure) {
      if (!pathStructure) {
        return obj;
      }
      function cloneSelectively(source, pathMap, depth = 0) {
        if (!pathMap || pathMap.size === 0) {
          return source;
        }
        if (source === null || typeof source !== "object") {
          return source;
        }
        if (source instanceof Date) {
          return new Date(source.getTime());
        }
        if (Array.isArray(source)) {
          const cloned2 = [];
          for (let i = 0; i < source.length; i++) {
            const indexStr = i.toString();
            if (pathMap.has(indexStr) || pathMap.has("*")) {
              cloned2[i] = cloneSelectively(source[i], pathMap.get(indexStr) || pathMap.get("*"));
            } else {
              cloned2[i] = source[i];
            }
          }
          return cloned2;
        }
        const cloned = Object.create(Object.getPrototypeOf(source));
        for (const key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            if (pathMap.has(key) || pathMap.has("*")) {
              cloned[key] = cloneSelectively(source[key], pathMap.get(key) || pathMap.get("*"));
            } else {
              cloned[key] = source[key];
            }
          }
        }
        return cloned;
      }
      return cloneSelectively(obj, pathStructure);
    }
    function validatePath(path) {
      if (typeof path !== "string") {
        throw new Error("Paths must be (non-empty) strings");
      }
      if (path === "") {
        throw new Error("Invalid redaction path ()");
      }
      if (path.includes("..")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      if (path.includes(",")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      let bracketCount = 0;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if ((char === '"' || char === "'") && bracketCount > 0) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          }
        } else if (char === "[" && !inQuotes) {
          bracketCount++;
        } else if (char === "]" && !inQuotes) {
          bracketCount--;
          if (bracketCount < 0) {
            throw new Error(`Invalid redaction path (${path})`);
          }
        }
      }
      if (bracketCount !== 0) {
        throw new Error(`Invalid redaction path (${path})`);
      }
    }
    function validatePaths(paths) {
      if (!Array.isArray(paths)) {
        throw new TypeError("paths must be an array");
      }
      for (const path of paths) {
        validatePath(path);
      }
    }
    function slowRedact(options = {}) {
      const {
        paths = [],
        censor = "[REDACTED]",
        serialize = JSON.stringify,
        strict = true,
        remove = false
      } = options;
      validatePaths(paths);
      const pathStructure = buildPathStructure(paths);
      return function redact(obj) {
        if (strict && (obj === null || typeof obj !== "object")) {
          if (obj === null || obj === void 0) {
            return serialize ? serialize(obj) : obj;
          }
          if (typeof obj !== "object") {
            return serialize ? serialize(obj) : obj;
          }
        }
        const cloned = selectiveClone(obj, pathStructure);
        const original = obj;
        let actualCensor = censor;
        if (typeof censor === "function") {
          actualCensor = censor;
        }
        redactPaths(cloned, paths, actualCensor, remove);
        if (serialize === false) {
          cloned.restore = function() {
            return deepClone(original);
          };
          return cloned;
        }
        if (typeof serialize === "function") {
          return serialize(cloned);
        }
        return JSON.stringify(cloned);
      };
    }
    module.exports = slowRedact;
  }
});

// ../../node_modules/pino/lib/symbols.js
var require_symbols = __commonJS({
  "../../node_modules/pino/lib/symbols.js"(exports$1, module) {
    var setLevelSym = /* @__PURE__ */ Symbol("pino.setLevel");
    var getLevelSym = /* @__PURE__ */ Symbol("pino.getLevel");
    var levelValSym = /* @__PURE__ */ Symbol("pino.levelVal");
    var levelCompSym = /* @__PURE__ */ Symbol("pino.levelComp");
    var useLevelLabelsSym = /* @__PURE__ */ Symbol("pino.useLevelLabels");
    var useOnlyCustomLevelsSym = /* @__PURE__ */ Symbol("pino.useOnlyCustomLevels");
    var mixinSym = /* @__PURE__ */ Symbol("pino.mixin");
    var lsCacheSym = /* @__PURE__ */ Symbol("pino.lsCache");
    var chindingsSym = /* @__PURE__ */ Symbol("pino.chindings");
    var asJsonSym = /* @__PURE__ */ Symbol("pino.asJson");
    var writeSym = /* @__PURE__ */ Symbol("pino.write");
    var redactFmtSym = /* @__PURE__ */ Symbol("pino.redactFmt");
    var timeSym = /* @__PURE__ */ Symbol("pino.time");
    var timeSliceIndexSym = /* @__PURE__ */ Symbol("pino.timeSliceIndex");
    var streamSym = /* @__PURE__ */ Symbol("pino.stream");
    var stringifySym = /* @__PURE__ */ Symbol("pino.stringify");
    var stringifySafeSym = /* @__PURE__ */ Symbol("pino.stringifySafe");
    var stringifiersSym = /* @__PURE__ */ Symbol("pino.stringifiers");
    var endSym = /* @__PURE__ */ Symbol("pino.end");
    var formatOptsSym = /* @__PURE__ */ Symbol("pino.formatOpts");
    var messageKeySym = /* @__PURE__ */ Symbol("pino.messageKey");
    var errorKeySym = /* @__PURE__ */ Symbol("pino.errorKey");
    var nestedKeySym = /* @__PURE__ */ Symbol("pino.nestedKey");
    var nestedKeyStrSym = /* @__PURE__ */ Symbol("pino.nestedKeyStr");
    var mixinMergeStrategySym = /* @__PURE__ */ Symbol("pino.mixinMergeStrategy");
    var msgPrefixSym = /* @__PURE__ */ Symbol("pino.msgPrefix");
    var wildcardFirstSym = /* @__PURE__ */ Symbol("pino.wildcardFirst");
    var serializersSym = /* @__PURE__ */ Symbol.for("pino.serializers");
    var formattersSym = /* @__PURE__ */ Symbol.for("pino.formatters");
    var hooksSym = /* @__PURE__ */ Symbol.for("pino.hooks");
    var needsMetadataGsym = /* @__PURE__ */ Symbol.for("pino.metadata");
    module.exports = {
      setLevelSym,
      getLevelSym,
      levelValSym,
      levelCompSym,
      useLevelLabelsSym,
      mixinSym,
      lsCacheSym,
      chindingsSym,
      asJsonSym,
      writeSym,
      serializersSym,
      redactFmtSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      wildcardFirstSym,
      needsMetadataGsym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    };
  }
});

// ../../node_modules/pino/lib/redaction.js
var require_redaction = __commonJS({
  "../../node_modules/pino/lib/redaction.js"(exports$1, module) {
    var Redact = require_redact();
    var { redactFmtSym, wildcardFirstSym } = require_symbols();
    var rx = /[^.[\]]+|\[([^[\]]*?)\]/g;
    var CENSOR = "[Redacted]";
    var strict = false;
    function redaction(opts, serialize) {
      const { paths, censor, remove } = handle(opts);
      const shape = paths.reduce((o, str) => {
        rx.lastIndex = 0;
        const first = rx.exec(str);
        const next = rx.exec(str);
        let ns = first[1] !== void 0 ? first[1].replace(/^(?:"|'|`)(.*)(?:"|'|`)$/, "$1") : first[0];
        if (ns === "*") {
          ns = wildcardFirstSym;
        }
        if (next === null) {
          o[ns] = null;
          return o;
        }
        if (o[ns] === null) {
          return o;
        }
        const { index } = next;
        const nextPath = `${str.substr(index, str.length - 1)}`;
        o[ns] = o[ns] || [];
        if (ns !== wildcardFirstSym && o[ns].length === 0) {
          o[ns].push(...o[wildcardFirstSym] || []);
        }
        if (ns === wildcardFirstSym) {
          Object.keys(o).forEach(function(k) {
            if (o[k]) {
              o[k].push(nextPath);
            }
          });
        }
        o[ns].push(nextPath);
        return o;
      }, {});
      const result = {
        [redactFmtSym]: Redact({ paths, censor, serialize, strict, remove })
      };
      const topCensor = (...args) => {
        return typeof censor === "function" ? serialize(censor(...args)) : serialize(censor);
      };
      return [...Object.keys(shape), ...Object.getOwnPropertySymbols(shape)].reduce((o, k) => {
        if (shape[k] === null) {
          o[k] = (value) => topCensor(value, [k]);
        } else {
          const wrappedCensor = typeof censor === "function" ? (value, path) => {
            return censor(value, [k, ...path]);
          } : censor;
          o[k] = Redact({
            paths: shape[k],
            censor: wrappedCensor,
            serialize,
            strict,
            remove
          });
        }
        return o;
      }, result);
    }
    function handle(opts) {
      if (Array.isArray(opts)) {
        opts = { paths: opts, censor: CENSOR };
        return opts;
      }
      let { paths, censor = CENSOR, remove } = opts;
      if (Array.isArray(paths) === false) {
        throw Error("pino \u2013 redact must contain an array of strings");
      }
      if (remove === true) censor = void 0;
      return { paths, censor, remove };
    }
    module.exports = redaction;
  }
});

// ../../node_modules/pino/lib/time.js
var require_time = __commonJS({
  "../../node_modules/pino/lib/time.js"(exports$1, module) {
    var nullTime = () => "";
    var epochTime = () => `,"time":${Date.now()}`;
    var unixTime = () => `,"time":${Math.round(Date.now() / 1e3)}`;
    var isoTime = () => `,"time":"${new Date(Date.now()).toISOString()}"`;
    var NS_PER_MS = 1000000n;
    var NS_PER_SEC = 1000000000n;
    var startWallTimeNs = BigInt(Date.now()) * NS_PER_MS;
    var startHrTime = process.hrtime.bigint();
    var isoTimeNano = () => {
      const elapsedNs = process.hrtime.bigint() - startHrTime;
      const currentTimeNs = startWallTimeNs + elapsedNs;
      const secondsSinceEpoch = currentTimeNs / NS_PER_SEC;
      const nanosWithinSecond = currentTimeNs % NS_PER_SEC;
      const msSinceEpoch = Number(secondsSinceEpoch * 1000n + nanosWithinSecond / 1000000n);
      const date = new Date(msSinceEpoch);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = date.getUTCDate().toString().padStart(2, "0");
      const hours = date.getUTCHours().toString().padStart(2, "0");
      const minutes = date.getUTCMinutes().toString().padStart(2, "0");
      const seconds = date.getUTCSeconds().toString().padStart(2, "0");
      return `,"time":"${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${nanosWithinSecond.toString().padStart(9, "0")}Z"`;
    };
    module.exports = { nullTime, epochTime, unixTime, isoTime, isoTimeNano };
  }
});

// ../../node_modules/quick-format-unescaped/index.js
var require_quick_format_unescaped = __commonJS({
  "../../node_modules/quick-format-unescaped/index.js"(exports$1, module) {
    function tryStringify(o) {
      try {
        return JSON.stringify(o);
      } catch (e) {
        return '"[Circular]"';
      }
    }
    module.exports = format;
    function format(f, args, opts) {
      var ss = opts && opts.stringify || tryStringify;
      var offset = 1;
      if (typeof f === "object" && f !== null) {
        var len = args.length + offset;
        if (len === 1) return f;
        var objects = new Array(len);
        objects[0] = ss(f);
        for (var index = 1; index < len; index++) {
          objects[index] = ss(args[index]);
        }
        return objects.join(" ");
      }
      if (typeof f !== "string") {
        return f;
      }
      var argLen = args.length;
      if (argLen === 0) return f;
      var str = "";
      var a = 1 - offset;
      var lastPos = -1;
      var flen = f && f.length || 0;
      for (var i = 0; i < flen; ) {
        if (f.charCodeAt(i) === 37 && i + 1 < flen) {
          lastPos = lastPos > -1 ? lastPos : 0;
          switch (f.charCodeAt(i + 1)) {
            case 100:
            // 'd'
            case 102:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Number(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 105:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Math.floor(Number(args[a]));
              lastPos = i + 2;
              i++;
              break;
            case 79:
            // 'O'
            case 111:
            // 'o'
            case 106:
              if (a >= argLen)
                break;
              if (args[a] === void 0) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              var type = typeof args[a];
              if (type === "string") {
                str += "'" + args[a] + "'";
                lastPos = i + 2;
                i++;
                break;
              }
              if (type === "function") {
                str += args[a].name || "<anonymous>";
                lastPos = i + 2;
                i++;
                break;
              }
              str += ss(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 115:
              if (a >= argLen)
                break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += String(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 37:
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += "%";
              lastPos = i + 2;
              i++;
              a--;
              break;
          }
          ++a;
        }
        ++i;
      }
      if (lastPos === -1)
        return f;
      else if (lastPos < flen) {
        str += f.slice(lastPos);
      }
      return str;
    }
  }
});

// ../../node_modules/atomic-sleep/index.js
var require_atomic_sleep = __commonJS({
  "../../node_modules/atomic-sleep/index.js"(exports$1, module) {
    if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
        Atomics.wait(nil, 0, 0, Number(ms));
      };
      const nil = new Int32Array(new SharedArrayBuffer(4));
      module.exports = sleep;
    } else {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
      };
      module.exports = sleep;
    }
  }
});

// ../../node_modules/sonic-boom/index.js
var require_sonic_boom = __commonJS({
  "../../node_modules/sonic-boom/index.js"(exports$1, module) {
    var fs = __require("fs");
    var EventEmitter = __require("events");
    var inherits = __require("util").inherits;
    var path = __require("path");
    var sleep = require_atomic_sleep();
    var assert = __require("assert");
    var BUSY_WRITE_TIMEOUT = 100;
    var kEmptyBuffer = Buffer.allocUnsafe(0);
    var MAX_WRITE = 16 * 1024;
    var kContentModeBuffer = "buffer";
    var kContentModeUtf8 = "utf8";
    var [major, minor] = (process.versions.node || "0.0").split(".").map(Number);
    var kCopyBuffer = major >= 22 && minor >= 7;
    function openFile(file, sonic) {
      sonic._opening = true;
      sonic._writing = true;
      sonic._asyncDrainScheduled = false;
      function fileOpened(err, fd) {
        if (err) {
          sonic._reopening = false;
          sonic._writing = false;
          sonic._opening = false;
          if (sonic.sync) {
            process.nextTick(() => {
              if (sonic.listenerCount("error") > 0) {
                sonic.emit("error", err);
              }
            });
          } else {
            sonic.emit("error", err);
          }
          return;
        }
        const reopening = sonic._reopening;
        sonic.fd = fd;
        sonic.file = file;
        sonic._reopening = false;
        sonic._opening = false;
        sonic._writing = false;
        if (sonic.sync) {
          process.nextTick(() => sonic.emit("ready"));
        } else {
          sonic.emit("ready");
        }
        if (sonic.destroyed) {
          return;
        }
        if (!sonic._writing && sonic._len > sonic.minLength || sonic._flushPending) {
          sonic._actualWrite();
        } else if (reopening) {
          process.nextTick(() => sonic.emit("drain"));
        }
      }
      const flags = sonic.append ? "a" : "w";
      const mode = sonic.mode;
      if (sonic.sync) {
        try {
          if (sonic.mkdir) fs.mkdirSync(path.dirname(file), { recursive: true });
          const fd = fs.openSync(file, flags, mode);
          fileOpened(null, fd);
        } catch (err) {
          fileOpened(err);
          throw err;
        }
      } else if (sonic.mkdir) {
        fs.mkdir(path.dirname(file), { recursive: true }, (err) => {
          if (err) return fileOpened(err);
          fs.open(file, flags, mode, fileOpened);
        });
      } else {
        fs.open(file, flags, mode, fileOpened);
      }
    }
    function SonicBoom(opts) {
      if (!(this instanceof SonicBoom)) {
        return new SonicBoom(opts);
      }
      let { fd, dest, minLength, maxLength, maxWrite, periodicFlush, sync, append = true, mkdir, retryEAGAIN, fsync, contentMode, mode } = opts || {};
      fd = fd || dest;
      this._len = 0;
      this.fd = -1;
      this._bufs = [];
      this._lens = [];
      this._writing = false;
      this._ending = false;
      this._reopening = false;
      this._asyncDrainScheduled = false;
      this._flushPending = false;
      this._hwm = Math.max(minLength || 0, 16387);
      this.file = null;
      this.destroyed = false;
      this.minLength = minLength || 0;
      this.maxLength = maxLength || 0;
      this.maxWrite = maxWrite || MAX_WRITE;
      this._periodicFlush = periodicFlush || 0;
      this._periodicFlushTimer = void 0;
      this.sync = sync || false;
      this.writable = true;
      this._fsync = fsync || false;
      this.append = append || false;
      this.mode = mode;
      this.retryEAGAIN = retryEAGAIN || (() => true);
      this.mkdir = mkdir || false;
      let fsWriteSync;
      let fsWrite;
      if (contentMode === kContentModeBuffer) {
        this._writingBuf = kEmptyBuffer;
        this.write = writeBuffer;
        this.flush = flushBuffer;
        this.flushSync = flushBufferSync;
        this._actualWrite = actualWriteBuffer;
        fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf);
        fsWrite = () => fs.write(this.fd, this._writingBuf, this.release);
      } else if (contentMode === void 0 || contentMode === kContentModeUtf8) {
        this._writingBuf = "";
        this.write = write;
        this.flush = flush;
        this.flushSync = flushSync;
        this._actualWrite = actualWrite;
        fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf, "utf8");
        fsWrite = () => fs.write(this.fd, this._writingBuf, "utf8", this.release);
      } else {
        throw new Error(`SonicBoom supports "${kContentModeUtf8}" and "${kContentModeBuffer}", but passed ${contentMode}`);
      }
      if (typeof fd === "number") {
        this.fd = fd;
        process.nextTick(() => this.emit("ready"));
      } else if (typeof fd === "string") {
        openFile(fd, this);
      } else {
        throw new Error("SonicBoom supports only file descriptors and files");
      }
      if (this.minLength >= this.maxWrite) {
        throw new Error(`minLength should be smaller than maxWrite (${this.maxWrite})`);
      }
      this.release = (err, n) => {
        if (err) {
          if ((err.code === "EAGAIN" || err.code === "EBUSY") && this.retryEAGAIN(err, this._writingBuf.length, this._len - this._writingBuf.length)) {
            if (this.sync) {
              try {
                sleep(BUSY_WRITE_TIMEOUT);
                this.release(void 0, 0);
              } catch (err2) {
                this.release(err2);
              }
            } else {
              setTimeout(fsWrite, BUSY_WRITE_TIMEOUT);
            }
          } else {
            this._writing = false;
            this.emit("error", err);
          }
          return;
        }
        this.emit("write", n);
        const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n);
        this._len = releasedBufObj.len;
        this._writingBuf = releasedBufObj.writingBuf;
        if (this._writingBuf.length) {
          if (!this.sync) {
            fsWrite();
            return;
          }
          try {
            do {
              const n2 = fsWriteSync();
              const releasedBufObj2 = releaseWritingBuf(this._writingBuf, this._len, n2);
              this._len = releasedBufObj2.len;
              this._writingBuf = releasedBufObj2.writingBuf;
            } while (this._writingBuf.length);
          } catch (err2) {
            this.release(err2);
            return;
          }
        }
        if (this._fsync) {
          fs.fsyncSync(this.fd);
        }
        const len = this._len;
        if (this._reopening) {
          this._writing = false;
          this._reopening = false;
          this.reopen();
        } else if (len > this.minLength) {
          this._actualWrite();
        } else if (this._ending) {
          if (len > 0) {
            this._actualWrite();
          } else {
            this._writing = false;
            actualClose(this);
          }
        } else {
          this._writing = false;
          if (this.sync) {
            if (!this._asyncDrainScheduled) {
              this._asyncDrainScheduled = true;
              process.nextTick(emitDrain, this);
            }
          } else {
            this.emit("drain");
          }
        }
      };
      this.on("newListener", function(name) {
        if (name === "drain") {
          this._asyncDrainScheduled = false;
        }
      });
      if (this._periodicFlush !== 0) {
        this._periodicFlushTimer = setInterval(() => this.flush(null), this._periodicFlush);
        this._periodicFlushTimer.unref();
      }
    }
    function releaseWritingBuf(writingBuf, len, n) {
      if (typeof writingBuf === "string" && Buffer.byteLength(writingBuf) !== n) {
        n = Buffer.from(writingBuf).subarray(0, n).toString().length;
      }
      len = Math.max(len - n, 0);
      writingBuf = writingBuf.slice(n);
      return { writingBuf, len };
    }
    function emitDrain(sonic) {
      const hasListeners = sonic.listenerCount("drain") > 0;
      if (!hasListeners) return;
      sonic._asyncDrainScheduled = false;
      sonic.emit("drain");
    }
    inherits(SonicBoom, EventEmitter);
    function mergeBuf(bufs, len) {
      if (bufs.length === 0) {
        return kEmptyBuffer;
      }
      if (bufs.length === 1) {
        return bufs[0];
      }
      return Buffer.concat(bufs, len);
    }
    function write(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      const len = this._len + data.length;
      const bufs = this._bufs;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || bufs[bufs.length - 1].length + data.length > this.maxWrite) {
        bufs.push("" + data);
      } else {
        bufs[bufs.length - 1] += data;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function writeBuffer(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      const len = this._len + data.length;
      const bufs = this._bufs;
      const lens = this._lens;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || lens[lens.length - 1] + data.length > this.maxWrite) {
        bufs.push([data]);
        lens.push(data.length);
      } else {
        bufs[bufs.length - 1].push(data);
        lens[lens.length - 1] += data.length;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function callFlushCallbackOnDrain(cb) {
      this._flushPending = true;
      const onDrain = () => {
        if (!this._fsync) {
          try {
            fs.fsync(this.fd, (err) => {
              this._flushPending = false;
              cb(err);
            });
          } catch (err) {
            cb(err);
          }
        } else {
          this._flushPending = false;
          cb();
        }
        this.off("error", onError);
      };
      const onError = (err) => {
        this._flushPending = false;
        cb(err);
        this.off("drain", onDrain);
      };
      this.once("drain", onDrain);
      this.once("error", onError);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push("");
      }
      this._actualWrite();
    }
    function flushBuffer(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push([]);
        this._lens.push(0);
      }
      this._actualWrite();
    }
    SonicBoom.prototype.reopen = function(file) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.reopen(file);
        });
        return;
      }
      if (this._ending) {
        return;
      }
      if (!this.file) {
        throw new Error("Unable to reopen a file descriptor, you must pass a file to SonicBoom");
      }
      if (file) {
        this.file = file;
      }
      this._reopening = true;
      if (this._writing) {
        return;
      }
      const fd = this.fd;
      this.once("ready", () => {
        if (fd !== this.fd) {
          fs.close(fd, (err) => {
            if (err) {
              return this.emit("error", err);
            }
          });
        }
      });
      openFile(this.file, this);
    };
    SonicBoom.prototype.end = function() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.end();
        });
        return;
      }
      if (this._ending) {
        return;
      }
      this._ending = true;
      if (this._writing) {
        return;
      }
      if (this._len > 0 && this.fd >= 0) {
        this._actualWrite();
      } else {
        actualClose(this);
      }
    };
    function flushSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift(this._writingBuf);
        this._writingBuf = "";
      }
      let buf = "";
      while (this._bufs.length || buf) {
        if (buf.length <= 0) {
          buf = this._bufs[0];
        }
        try {
          const n = fs.writeSync(this.fd, buf, "utf8");
          const releasedBufObj = releaseWritingBuf(buf, this._len, n);
          buf = releasedBufObj.writingBuf;
          this._len = releasedBufObj.len;
          if (buf.length <= 0) {
            this._bufs.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
      try {
        fs.fsyncSync(this.fd);
      } catch {
      }
    }
    function flushBufferSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift([this._writingBuf]);
        this._writingBuf = kEmptyBuffer;
      }
      let buf = kEmptyBuffer;
      while (this._bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = mergeBuf(this._bufs[0], this._lens[0]);
        }
        try {
          const n = fs.writeSync(this.fd, buf);
          buf = buf.subarray(n);
          this._len = Math.max(this._len - n, 0);
          if (buf.length <= 0) {
            this._bufs.shift();
            this._lens.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
    }
    SonicBoom.prototype.destroy = function() {
      if (this.destroyed) {
        return;
      }
      actualClose(this);
    };
    function actualWrite() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf || this._bufs.shift() || "";
      if (this.sync) {
        try {
          const written = fs.writeSync(this.fd, this._writingBuf, "utf8");
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        fs.write(this.fd, this._writingBuf, "utf8", release);
      }
    }
    function actualWriteBuffer() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf.length ? this._writingBuf : mergeBuf(this._bufs.shift(), this._lens.shift());
      if (this.sync) {
        try {
          const written = fs.writeSync(this.fd, this._writingBuf);
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        if (kCopyBuffer) {
          this._writingBuf = Buffer.from(this._writingBuf);
        }
        fs.write(this.fd, this._writingBuf, release);
      }
    }
    function actualClose(sonic) {
      if (sonic.fd === -1) {
        sonic.once("ready", actualClose.bind(null, sonic));
        return;
      }
      if (sonic._periodicFlushTimer !== void 0) {
        clearInterval(sonic._periodicFlushTimer);
      }
      sonic.destroyed = true;
      sonic._bufs = [];
      sonic._lens = [];
      assert(typeof sonic.fd === "number", `sonic.fd must be a number, got ${typeof sonic.fd}`);
      try {
        fs.fsync(sonic.fd, closeWrapped);
      } catch {
      }
      function closeWrapped() {
        if (sonic.fd !== 1 && sonic.fd !== 2) {
          fs.close(sonic.fd, done);
        } else {
          done();
        }
      }
      function done(err) {
        if (err) {
          sonic.emit("error", err);
          return;
        }
        if (sonic._ending && !sonic._writing) {
          sonic.emit("finish");
        }
        sonic.emit("close");
      }
    }
    SonicBoom.SonicBoom = SonicBoom;
    SonicBoom.default = SonicBoom;
    module.exports = SonicBoom;
  }
});

// ../../node_modules/on-exit-leak-free/index.js
var require_on_exit_leak_free = __commonJS({
  "../../node_modules/on-exit-leak-free/index.js"(exports$1, module) {
    var refs = {
      exit: [],
      beforeExit: []
    };
    var functions = {
      exit: onExit,
      beforeExit: onBeforeExit
    };
    var registry;
    function ensureRegistry() {
      if (registry === void 0) {
        registry = new FinalizationRegistry(clear);
      }
    }
    function install(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.on(event, functions[event]);
    }
    function uninstall(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.removeListener(event, functions[event]);
      if (refs.exit.length === 0 && refs.beforeExit.length === 0) {
        registry = void 0;
      }
    }
    function onExit() {
      callRefs("exit");
    }
    function onBeforeExit() {
      callRefs("beforeExit");
    }
    function callRefs(event) {
      for (const ref of refs[event]) {
        const obj = ref.deref();
        const fn = ref.fn;
        if (obj !== void 0) {
          fn(obj, event);
        }
      }
      refs[event] = [];
    }
    function clear(ref) {
      for (const event of ["exit", "beforeExit"]) {
        const index = refs[event].indexOf(ref);
        refs[event].splice(index, index + 1);
        uninstall(event);
      }
    }
    function _register(event, obj, fn) {
      if (obj === void 0) {
        throw new Error("the object can't be undefined");
      }
      install(event);
      const ref = new WeakRef(obj);
      ref.fn = fn;
      ensureRegistry();
      registry.register(obj, ref);
      refs[event].push(ref);
    }
    function register(obj, fn) {
      _register("exit", obj, fn);
    }
    function registerBeforeExit(obj, fn) {
      _register("beforeExit", obj, fn);
    }
    function unregister(obj) {
      if (registry === void 0) {
        return;
      }
      registry.unregister(obj);
      for (const event of ["exit", "beforeExit"]) {
        refs[event] = refs[event].filter((ref) => {
          const _obj = ref.deref();
          return _obj && _obj !== obj;
        });
        uninstall(event);
      }
    }
    module.exports = {
      register,
      registerBeforeExit,
      unregister
    };
  }
});

// ../../node_modules/thread-stream/package.json
var require_package2 = __commonJS({
  "../../node_modules/thread-stream/package.json"(exports$1, module) {
    module.exports = {
      name: "thread-stream",
      version: "3.1.0",
      description: "A streaming way to send data to a Node.js Worker Thread",
      main: "index.js",
      types: "index.d.ts",
      dependencies: {
        "real-require": "^0.2.0"
      },
      devDependencies: {
        "@types/node": "^20.1.0",
        "@types/tap": "^15.0.0",
        "@yao-pkg/pkg": "^5.11.5",
        desm: "^1.3.0",
        fastbench: "^1.0.1",
        husky: "^9.0.6",
        "pino-elasticsearch": "^8.0.0",
        "sonic-boom": "^4.0.1",
        standard: "^17.0.0",
        tap: "^16.2.0",
        "ts-node": "^10.8.0",
        typescript: "^5.3.2",
        "why-is-node-running": "^2.2.2"
      },
      scripts: {
        build: "tsc --noEmit",
        test: 'standard && npm run build && npm run transpile && tap "test/**/*.test.*js" && tap --ts test/*.test.*ts',
        "test:ci": "standard && npm run transpile && npm run test:ci:js && npm run test:ci:ts",
        "test:ci:js": 'tap --no-check-coverage --timeout=120 --coverage-report=lcovonly "test/**/*.test.*js"',
        "test:ci:ts": 'tap --ts --no-check-coverage --coverage-report=lcovonly "test/**/*.test.*ts"',
        "test:yarn": 'npm run transpile && tap "test/**/*.test.js" --no-check-coverage',
        transpile: "sh ./test/ts/transpile.sh",
        prepare: "husky install"
      },
      standard: {
        ignore: [
          "test/ts/**/*",
          "test/syntax-error.mjs"
        ]
      },
      repository: {
        type: "git",
        url: "git+https://github.com/mcollina/thread-stream.git"
      },
      keywords: [
        "worker",
        "thread",
        "threads",
        "stream"
      ],
      author: "Matteo Collina <hello@matteocollina.com>",
      license: "MIT",
      bugs: {
        url: "https://github.com/mcollina/thread-stream/issues"
      },
      homepage: "https://github.com/mcollina/thread-stream#readme"
    };
  }
});

// ../../node_modules/thread-stream/lib/wait.js
var require_wait = __commonJS({
  "../../node_modules/thread-stream/lib/wait.js"(exports$1, module) {
    var MAX_TIMEOUT = 1e3;
    function wait(state, index, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index);
      if (current === expected) {
        done(null, "ok");
        return;
      }
      let prior = current;
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            prior = current;
            current = Atomics.load(state, index);
            if (current === prior) {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            } else {
              if (current === expected) done(null, "ok");
              else done(null, "not-equal");
            }
          }, backoff);
        }
      };
      check(1);
    }
    function waitDiff(state, index, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index);
      if (current !== expected) {
        done(null, "ok");
        return;
      }
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            current = Atomics.load(state, index);
            if (current !== expected) {
              done(null, "ok");
            } else {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            }
          }, backoff);
        }
      };
      check(1);
    }
    module.exports = { wait, waitDiff };
  }
});

// ../../node_modules/thread-stream/lib/indexes.js
var require_indexes = __commonJS({
  "../../node_modules/thread-stream/lib/indexes.js"(exports$1, module) {
    var WRITE_INDEX = 4;
    var READ_INDEX = 8;
    module.exports = {
      WRITE_INDEX,
      READ_INDEX
    };
  }
});

// ../../node_modules/thread-stream/index.js
var require_thread_stream = __commonJS({
  "../../node_modules/thread-stream/index.js"(exports$1, module) {
    var { version } = require_package2();
    var { EventEmitter } = __require("events");
    var { Worker } = __require("worker_threads");
    var { join } = __require("path");
    var { pathToFileURL } = __require("url");
    var { wait } = require_wait();
    var {
      WRITE_INDEX,
      READ_INDEX
    } = require_indexes();
    var buffer = __require("buffer");
    var assert = __require("assert");
    var kImpl = /* @__PURE__ */ Symbol("kImpl");
    var MAX_STRING = buffer.constants.MAX_STRING_LENGTH;
    var FakeWeakRef = class {
      constructor(value) {
        this._value = value;
      }
      deref() {
        return this._value;
      }
    };
    var FakeFinalizationRegistry = class {
      register() {
      }
      unregister() {
      }
    };
    var FinalizationRegistry2 = process.env.NODE_V8_COVERAGE ? FakeFinalizationRegistry : global.FinalizationRegistry || FakeFinalizationRegistry;
    var WeakRef2 = process.env.NODE_V8_COVERAGE ? FakeWeakRef : global.WeakRef || FakeWeakRef;
    var registry = new FinalizationRegistry2((worker) => {
      if (worker.exited) {
        return;
      }
      worker.terminate();
    });
    function createWorker(stream, opts) {
      const { filename, workerData } = opts;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      const toExecute = bundlerOverrides["thread-stream-worker"] || join(__dirname, "lib", "worker.js");
      const worker = new Worker(toExecute, {
        ...opts.workerOpts,
        trackUnmanagedFds: false,
        workerData: {
          filename: filename.indexOf("file://") === 0 ? filename : pathToFileURL(filename).href,
          dataBuf: stream[kImpl].dataBuf,
          stateBuf: stream[kImpl].stateBuf,
          workerData: {
            $context: {
              threadStreamVersion: version
            },
            ...workerData
          }
        }
      });
      worker.stream = new FakeWeakRef(stream);
      worker.on("message", onWorkerMessage);
      worker.on("exit", onWorkerExit);
      registry.register(stream, worker);
      return worker;
    }
    function drain(stream) {
      assert(!stream[kImpl].sync);
      if (stream[kImpl].needDrain) {
        stream[kImpl].needDrain = false;
        stream.emit("drain");
      }
    }
    function nextFlush(stream) {
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let leftover = stream[kImpl].data.length - writeIndex;
      if (leftover > 0) {
        if (stream[kImpl].buf.length === 0) {
          stream[kImpl].flushing = false;
          if (stream[kImpl].ending) {
            end(stream);
          } else if (stream[kImpl].needDrain) {
            process.nextTick(drain, stream);
          }
          return;
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, nextFlush.bind(null, stream));
        } else {
          stream.flush(() => {
            if (stream.destroyed) {
              return;
            }
            Atomics.store(stream[kImpl].state, READ_INDEX, 0);
            Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
            while (toWriteBytes > stream[kImpl].data.length) {
              leftover = leftover / 2;
              toWrite = stream[kImpl].buf.slice(0, leftover);
              toWriteBytes = Buffer.byteLength(toWrite);
            }
            stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
            write(stream, toWrite, nextFlush.bind(null, stream));
          });
        }
      } else if (leftover === 0) {
        if (writeIndex === 0 && stream[kImpl].buf.length === 0) {
          return;
        }
        stream.flush(() => {
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          nextFlush(stream);
        });
      } else {
        destroy(stream, new Error("overwritten"));
      }
    }
    function onWorkerMessage(msg) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        this.exited = true;
        this.terminate();
        return;
      }
      switch (msg.code) {
        case "READY":
          this.stream = new WeakRef2(stream);
          stream.flush(() => {
            stream[kImpl].ready = true;
            stream.emit("ready");
          });
          break;
        case "ERROR":
          destroy(stream, msg.err);
          break;
        case "EVENT":
          if (Array.isArray(msg.args)) {
            stream.emit(msg.name, ...msg.args);
          } else {
            stream.emit(msg.name, msg.args);
          }
          break;
        case "WARNING":
          process.emitWarning(msg.err);
          break;
        default:
          destroy(stream, new Error("this should not happen: " + msg.code));
      }
    }
    function onWorkerExit(code) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        return;
      }
      registry.unregister(stream);
      stream.worker.exited = true;
      stream.worker.off("exit", onWorkerExit);
      destroy(stream, code !== 0 ? new Error("the worker thread exited") : null);
    }
    var ThreadStream = class extends EventEmitter {
      constructor(opts = {}) {
        super();
        if (opts.bufferSize < 4) {
          throw new Error("bufferSize must at least fit a 4-byte utf-8 char");
        }
        this[kImpl] = {};
        this[kImpl].stateBuf = new SharedArrayBuffer(128);
        this[kImpl].state = new Int32Array(this[kImpl].stateBuf);
        this[kImpl].dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024);
        this[kImpl].data = Buffer.from(this[kImpl].dataBuf);
        this[kImpl].sync = opts.sync || false;
        this[kImpl].ending = false;
        this[kImpl].ended = false;
        this[kImpl].needDrain = false;
        this[kImpl].destroyed = false;
        this[kImpl].flushing = false;
        this[kImpl].ready = false;
        this[kImpl].finished = false;
        this[kImpl].errored = null;
        this[kImpl].closed = false;
        this[kImpl].buf = "";
        this.worker = createWorker(this, opts);
        this.on("message", (message, transferList) => {
          this.worker.postMessage(message, transferList);
        });
      }
      write(data) {
        if (this[kImpl].destroyed) {
          error(this, new Error("the worker has exited"));
          return false;
        }
        if (this[kImpl].ending) {
          error(this, new Error("the worker is ending"));
          return false;
        }
        if (this[kImpl].flushing && this[kImpl].buf.length + data.length >= MAX_STRING) {
          try {
            writeSync(this);
            this[kImpl].flushing = true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        this[kImpl].buf += data;
        if (this[kImpl].sync) {
          try {
            writeSync(this);
            return true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        if (!this[kImpl].flushing) {
          this[kImpl].flushing = true;
          setImmediate(nextFlush, this);
        }
        this[kImpl].needDrain = this[kImpl].data.length - this[kImpl].buf.length - Atomics.load(this[kImpl].state, WRITE_INDEX) <= 0;
        return !this[kImpl].needDrain;
      }
      end() {
        if (this[kImpl].destroyed) {
          return;
        }
        this[kImpl].ending = true;
        end(this);
      }
      flush(cb) {
        if (this[kImpl].destroyed) {
          if (typeof cb === "function") {
            process.nextTick(cb, new Error("the worker has exited"));
          }
          return;
        }
        const writeIndex = Atomics.load(this[kImpl].state, WRITE_INDEX);
        wait(this[kImpl].state, READ_INDEX, writeIndex, Infinity, (err, res) => {
          if (err) {
            destroy(this, err);
            process.nextTick(cb, err);
            return;
          }
          if (res === "not-equal") {
            this.flush(cb);
            return;
          }
          process.nextTick(cb);
        });
      }
      flushSync() {
        if (this[kImpl].destroyed) {
          return;
        }
        writeSync(this);
        flushSync(this);
      }
      unref() {
        this.worker.unref();
      }
      ref() {
        this.worker.ref();
      }
      get ready() {
        return this[kImpl].ready;
      }
      get destroyed() {
        return this[kImpl].destroyed;
      }
      get closed() {
        return this[kImpl].closed;
      }
      get writable() {
        return !this[kImpl].destroyed && !this[kImpl].ending;
      }
      get writableEnded() {
        return this[kImpl].ending;
      }
      get writableFinished() {
        return this[kImpl].finished;
      }
      get writableNeedDrain() {
        return this[kImpl].needDrain;
      }
      get writableObjectMode() {
        return false;
      }
      get writableErrored() {
        return this[kImpl].errored;
      }
    };
    function error(stream, err) {
      setImmediate(() => {
        stream.emit("error", err);
      });
    }
    function destroy(stream, err) {
      if (stream[kImpl].destroyed) {
        return;
      }
      stream[kImpl].destroyed = true;
      if (err) {
        stream[kImpl].errored = err;
        error(stream, err);
      }
      if (!stream.worker.exited) {
        stream.worker.terminate().catch(() => {
        }).then(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      } else {
        setImmediate(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      }
    }
    function write(stream, data, cb) {
      const current = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      const length = Buffer.byteLength(data);
      stream[kImpl].data.write(data, current);
      Atomics.store(stream[kImpl].state, WRITE_INDEX, current + length);
      Atomics.notify(stream[kImpl].state, WRITE_INDEX);
      cb();
      return true;
    }
    function end(stream) {
      if (stream[kImpl].ended || !stream[kImpl].ending || stream[kImpl].flushing) {
        return;
      }
      stream[kImpl].ended = true;
      try {
        stream.flushSync();
        let readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, -1);
        Atomics.notify(stream[kImpl].state, WRITE_INDEX);
        let spins = 0;
        while (readIndex !== -1) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
          readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
          if (readIndex === -2) {
            destroy(stream, new Error("end() failed"));
            return;
          }
          if (++spins === 10) {
            destroy(stream, new Error("end() took too long (10s)"));
            return;
          }
        }
        process.nextTick(() => {
          stream[kImpl].finished = true;
          stream.emit("finish");
        });
      } catch (err) {
        destroy(stream, err);
      }
    }
    function writeSync(stream) {
      const cb = () => {
        if (stream[kImpl].ending) {
          end(stream);
        } else if (stream[kImpl].needDrain) {
          process.nextTick(drain, stream);
        }
      };
      stream[kImpl].flushing = false;
      while (stream[kImpl].buf.length !== 0) {
        const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
        let leftover = stream[kImpl].data.length - writeIndex;
        if (leftover === 0) {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          continue;
        } else if (leftover < 0) {
          throw new Error("overwritten");
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        } else {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          while (toWriteBytes > stream[kImpl].buf.length) {
            leftover = leftover / 2;
            toWrite = stream[kImpl].buf.slice(0, leftover);
            toWriteBytes = Buffer.byteLength(toWrite);
          }
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        }
      }
    }
    function flushSync(stream) {
      if (stream[kImpl].flushing) {
        throw new Error("unable to flush while flushing");
      }
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let spins = 0;
      while (true) {
        const readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        if (readIndex === -2) {
          throw Error("_flushSync failed");
        }
        if (readIndex !== writeIndex) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
        } else {
          break;
        }
        if (++spins === 10) {
          throw new Error("_flushSync took too long (10s)");
        }
      }
    }
    module.exports = ThreadStream;
  }
});

// ../../node_modules/pino/lib/transport.js
var require_transport = __commonJS({
  "../../node_modules/pino/lib/transport.js"(exports$1, module) {
    var { createRequire } = __require("module");
    var getCallers = require_caller();
    var { join, isAbsolute, sep } = __require("path");
    var sleep = require_atomic_sleep();
    var onExit = require_on_exit_leak_free();
    var ThreadStream = require_thread_stream();
    function setupOnExit(stream) {
      onExit.register(stream, autoEnd);
      onExit.registerBeforeExit(stream, flush);
      stream.on("close", function() {
        onExit.unregister(stream);
      });
    }
    function buildStream(filename, workerData, workerOpts, sync) {
      const stream = new ThreadStream({
        filename,
        workerData,
        workerOpts,
        sync
      });
      stream.on("ready", onReady);
      stream.on("close", function() {
        process.removeListener("exit", onExit2);
      });
      process.on("exit", onExit2);
      function onReady() {
        process.removeListener("exit", onExit2);
        stream.unref();
        if (workerOpts.autoEnd !== false) {
          setupOnExit(stream);
        }
      }
      function onExit2() {
        if (stream.closed) {
          return;
        }
        stream.flushSync();
        sleep(100);
        stream.end();
      }
      return stream;
    }
    function autoEnd(stream) {
      stream.ref();
      stream.flushSync();
      stream.end();
      stream.once("close", function() {
        stream.unref();
      });
    }
    function flush(stream) {
      stream.flushSync();
    }
    function transport(fullOptions) {
      const { pipeline, targets, levels, dedupe, worker = {}, caller = getCallers(), sync = false } = fullOptions;
      const options = {
        ...fullOptions.options
      };
      const callers = typeof caller === "string" ? [caller] : caller;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      let target = fullOptions.target;
      if (target && targets) {
        throw new Error("only one of target or targets can be specified");
      }
      if (targets) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.targets = targets.filter((dest) => dest.target).map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        });
        options.pipelines = targets.filter((dest) => dest.pipeline).map((dest) => {
          return dest.pipeline.map((t) => {
            return {
              ...t,
              level: dest.level,
              // duplicate the pipeline `level` property defined in the upper level
              target: fixTarget(t.target)
            };
          });
        });
      } else if (pipeline) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.pipelines = [pipeline.map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        })];
      }
      if (levels) {
        options.levels = levels;
      }
      if (dedupe) {
        options.dedupe = dedupe;
      }
      options.pinoWillSendConfig = true;
      return buildStream(fixTarget(target), options, worker, sync);
      function fixTarget(origin) {
        origin = bundlerOverrides[origin] || origin;
        if (isAbsolute(origin) || origin.indexOf("file://") === 0) {
          return origin;
        }
        if (origin === "pino/file") {
          return join(__dirname, "..", "file.js");
        }
        let fixTarget2;
        for (const filePath of callers) {
          try {
            const context = filePath === "node:repl" ? process.cwd() + sep : filePath;
            fixTarget2 = createRequire(context).resolve(origin);
            break;
          } catch (err) {
            continue;
          }
        }
        if (!fixTarget2) {
          throw new Error(`unable to determine transport target for "${origin}"`);
        }
        return fixTarget2;
      }
    }
    module.exports = transport;
  }
});

// ../../node_modules/pino/lib/tools.js
var require_tools = __commonJS({
  "../../node_modules/pino/lib/tools.js"(exports$1, module) {
    var diagChan = __require("diagnostics_channel");
    var format = require_quick_format_unescaped();
    var { mapHttpRequest, mapHttpResponse } = require_pino_std_serializers();
    var SonicBoom = require_sonic_boom();
    var onExit = require_on_exit_leak_free();
    var {
      lsCacheSym,
      chindingsSym,
      writeSym,
      serializersSym,
      formatOptsSym,
      endSym,
      stringifiersSym,
      stringifySym,
      stringifySafeSym,
      wildcardFirstSym,
      nestedKeySym,
      formattersSym,
      messageKeySym,
      errorKeySym,
      nestedKeyStrSym,
      msgPrefixSym
    } = require_symbols();
    var { isMainThread } = __require("worker_threads");
    var transport = require_transport();
    var asJsonChan;
    if (typeof diagChan.tracingChannel === "function") {
      asJsonChan = diagChan.tracingChannel("pino_asJson");
    } else {
      asJsonChan = {
        hasSubscribers: false,
        traceSync(fn, store, thisArg, ...args) {
          return fn.call(thisArg, ...args);
        }
      };
    }
    function noop() {
    }
    function genLog(level, hook) {
      if (!hook) return LOG;
      return function hookWrappedLog(...args) {
        hook.call(this, args, LOG, level);
      };
      function LOG(o, ...n) {
        if (typeof o === "object") {
          let msg = o;
          if (o !== null) {
            if (o.method && o.headers && o.socket) {
              o = mapHttpRequest(o);
            } else if (typeof o.setHeader === "function") {
              o = mapHttpResponse(o);
            }
          }
          let formatParams;
          if (msg === null && n.length === 0) {
            formatParams = [null];
          } else {
            msg = n.shift();
            formatParams = n;
          }
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](o, format(msg, formatParams, this[formatOptsSym]), level);
        } else {
          let msg = o === void 0 ? n.shift() : o;
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](null, format(msg, n, this[formatOptsSym]), level);
        }
      }
    }
    function asString(str) {
      let result = "";
      let last = 0;
      let found = false;
      let point = 255;
      const l = str.length;
      if (l > 100) {
        return JSON.stringify(str);
      }
      for (var i = 0; i < l && point >= 32; i++) {
        point = str.charCodeAt(i);
        if (point === 34 || point === 92) {
          result += str.slice(last, i) + "\\";
          last = i;
          found = true;
        }
      }
      if (!found) {
        result = str;
      } else {
        result += str.slice(last);
      }
      return point < 32 ? JSON.stringify(str) : '"' + result + '"';
    }
    function asJson(obj, msg, num, time) {
      if (asJsonChan.hasSubscribers === false) {
        return _asJson.call(this, obj, msg, num, time);
      }
      const store = { instance: this, arguments };
      return asJsonChan.traceSync(_asJson, store, this, obj, msg, num, time);
    }
    function _asJson(obj, msg, num, time) {
      const stringify2 = this[stringifySym];
      const stringifySafe = this[stringifySafeSym];
      const stringifiers = this[stringifiersSym];
      const end = this[endSym];
      const chindings = this[chindingsSym];
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const messageKey = this[messageKeySym];
      const errorKey = this[errorKeySym];
      let data = this[lsCacheSym][num] + time;
      data = data + chindings;
      let value;
      if (formatters.log) {
        obj = formatters.log(obj);
      }
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      let propStr = "";
      for (const key in obj) {
        value = obj[key];
        if (Object.prototype.hasOwnProperty.call(obj, key) && value !== void 0) {
          if (serializers[key]) {
            value = serializers[key](value);
          } else if (key === errorKey && serializers.err) {
            value = serializers.err(value);
          }
          const stringifier = stringifiers[key] || wildcardStringifier;
          switch (typeof value) {
            case "undefined":
            case "function":
              continue;
            case "number":
              if (Number.isFinite(value) === false) {
                value = null;
              }
            // this case explicitly falls through to the next one
            case "boolean":
              if (stringifier) value = stringifier(value);
              break;
            case "string":
              value = (stringifier || asString)(value);
              break;
            default:
              value = (stringifier || stringify2)(value, stringifySafe);
          }
          if (value === void 0) continue;
          const strKey = asString(key);
          propStr += "," + strKey + ":" + value;
        }
      }
      let msgStr = "";
      if (msg !== void 0) {
        value = serializers[messageKey] ? serializers[messageKey](msg) : msg;
        const stringifier = stringifiers[messageKey] || wildcardStringifier;
        switch (typeof value) {
          case "function":
            break;
          case "number":
            if (Number.isFinite(value) === false) {
              value = null;
            }
          // this case explicitly falls through to the next one
          case "boolean":
            if (stringifier) value = stringifier(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          case "string":
            value = (stringifier || asString)(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          default:
            value = (stringifier || stringify2)(value, stringifySafe);
            msgStr = ',"' + messageKey + '":' + value;
        }
      }
      if (this[nestedKeySym] && propStr) {
        return data + this[nestedKeyStrSym] + propStr.slice(1) + "}" + msgStr + end;
      } else {
        return data + propStr + msgStr + end;
      }
    }
    function asChindings(instance, bindings) {
      let value;
      let data = instance[chindingsSym];
      const stringify2 = instance[stringifySym];
      const stringifySafe = instance[stringifySafeSym];
      const stringifiers = instance[stringifiersSym];
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      const serializers = instance[serializersSym];
      const formatter = instance[formattersSym].bindings;
      bindings = formatter(bindings);
      for (const key in bindings) {
        value = bindings[key];
        const valid = (key.length < 5 || key !== "level" && key !== "serializers" && key !== "formatters" && key !== "customLevels") && bindings.hasOwnProperty(key) && value !== void 0;
        if (valid === true) {
          value = serializers[key] ? serializers[key](value) : value;
          value = (stringifiers[key] || wildcardStringifier || stringify2)(value, stringifySafe);
          if (value === void 0) continue;
          data += ',"' + key + '":' + value;
        }
      }
      return data;
    }
    function hasBeenTampered(stream) {
      return stream.write !== stream.constructor.prototype.write;
    }
    function buildSafeSonicBoom(opts) {
      const stream = new SonicBoom(opts);
      stream.on("error", filterBrokenPipe);
      if (!opts.sync && isMainThread) {
        onExit.register(stream, autoEnd);
        stream.on("close", function() {
          onExit.unregister(stream);
        });
      }
      return stream;
      function filterBrokenPipe(err) {
        if (err.code === "EPIPE") {
          stream.write = noop;
          stream.end = noop;
          stream.flushSync = noop;
          stream.destroy = noop;
          return;
        }
        stream.removeListener("error", filterBrokenPipe);
        stream.emit("error", err);
      }
    }
    function autoEnd(stream, eventName) {
      if (stream.destroyed) {
        return;
      }
      if (eventName === "beforeExit") {
        stream.flush();
        stream.on("drain", function() {
          stream.end();
        });
      } else {
        stream.flushSync();
      }
    }
    function createArgsNormalizer(defaultOptions) {
      return function normalizeArgs(instance, caller, opts = {}, stream) {
        if (typeof opts === "string") {
          stream = buildSafeSonicBoom({ dest: opts });
          opts = {};
        } else if (typeof stream === "string") {
          if (opts && opts.transport) {
            throw Error("only one of option.transport or stream can be specified");
          }
          stream = buildSafeSonicBoom({ dest: stream });
        } else if (opts instanceof SonicBoom || opts.writable || opts._writableState) {
          stream = opts;
          opts = {};
        } else if (opts.transport) {
          if (opts.transport instanceof SonicBoom || opts.transport.writable || opts.transport._writableState) {
            throw Error("option.transport do not allow stream, please pass to option directly. e.g. pino(transport)");
          }
          if (opts.transport.targets && opts.transport.targets.length && opts.formatters && typeof opts.formatters.level === "function") {
            throw Error("option.transport.targets do not allow custom level formatters");
          }
          let customLevels;
          if (opts.customLevels) {
            customLevels = opts.useOnlyCustomLevels ? opts.customLevels : Object.assign({}, opts.levels, opts.customLevels);
          }
          stream = transport({ caller, ...opts.transport, levels: customLevels });
        }
        opts = Object.assign({}, defaultOptions, opts);
        opts.serializers = Object.assign({}, defaultOptions.serializers, opts.serializers);
        opts.formatters = Object.assign({}, defaultOptions.formatters, opts.formatters);
        if (opts.prettyPrint) {
          throw new Error("prettyPrint option is no longer supported, see the pino-pretty package (https://github.com/pinojs/pino-pretty)");
        }
        const { enabled, onChild } = opts;
        if (enabled === false) opts.level = "silent";
        if (!onChild) opts.onChild = noop;
        if (!stream) {
          if (!hasBeenTampered(process.stdout)) {
            stream = buildSafeSonicBoom({ fd: process.stdout.fd || 1 });
          } else {
            stream = process.stdout;
          }
        }
        return { opts, stream };
      };
    }
    function stringify(obj, stringifySafeFn) {
      try {
        return JSON.stringify(obj);
      } catch (_) {
        try {
          const stringify2 = stringifySafeFn || this[stringifySafeSym];
          return stringify2(obj);
        } catch (_2) {
          return '"[unable to serialize, circular reference is too complex to analyze]"';
        }
      }
    }
    function buildFormatters(level, bindings, log) {
      return {
        level,
        bindings,
        log
      };
    }
    function normalizeDestFileDescriptor(destination) {
      const fd = Number(destination);
      if (typeof destination === "string" && Number.isFinite(fd)) {
        return fd;
      }
      if (destination === void 0) {
        return 1;
      }
      return destination;
    }
    module.exports = {
      noop,
      buildSafeSonicBoom,
      asChindings,
      asJson,
      genLog,
      createArgsNormalizer,
      stringify,
      buildFormatters,
      normalizeDestFileDescriptor
    };
  }
});

// ../../node_modules/pino/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/pino/lib/constants.js"(exports$1, module) {
    var DEFAULT_LEVELS = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60
    };
    var SORTING_ORDER = {
      ASC: "ASC",
      DESC: "DESC"
    };
    module.exports = {
      DEFAULT_LEVELS,
      SORTING_ORDER
    };
  }
});

// ../../node_modules/pino/lib/levels.js
var require_levels = __commonJS({
  "../../node_modules/pino/lib/levels.js"(exports$1, module) {
    var {
      lsCacheSym,
      levelValSym,
      useOnlyCustomLevelsSym,
      streamSym,
      formattersSym,
      hooksSym,
      levelCompSym
    } = require_symbols();
    var { noop, genLog } = require_tools();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var levelMethods = {
      fatal: (hook) => {
        const logFatal = genLog(DEFAULT_LEVELS.fatal, hook);
        return function(...args) {
          const stream = this[streamSym];
          logFatal.call(this, ...args);
          if (typeof stream.flushSync === "function") {
            try {
              stream.flushSync();
            } catch (e) {
            }
          }
        };
      },
      error: (hook) => genLog(DEFAULT_LEVELS.error, hook),
      warn: (hook) => genLog(DEFAULT_LEVELS.warn, hook),
      info: (hook) => genLog(DEFAULT_LEVELS.info, hook),
      debug: (hook) => genLog(DEFAULT_LEVELS.debug, hook),
      trace: (hook) => genLog(DEFAULT_LEVELS.trace, hook)
    };
    var nums = Object.keys(DEFAULT_LEVELS).reduce((o, k) => {
      o[DEFAULT_LEVELS[k]] = k;
      return o;
    }, {});
    var initialLsCache = Object.keys(nums).reduce((o, k) => {
      o[k] = '{"level":' + Number(k);
      return o;
    }, {});
    function genLsCache(instance) {
      const formatter = instance[formattersSym].level;
      const { labels } = instance.levels;
      const cache = {};
      for (const label in labels) {
        const level = formatter(labels[label], Number(label));
        cache[label] = JSON.stringify(level).slice(0, -1);
      }
      instance[lsCacheSym] = cache;
      return instance;
    }
    function isStandardLevel(level, useOnlyCustomLevels) {
      if (useOnlyCustomLevels) {
        return false;
      }
      switch (level) {
        case "fatal":
        case "error":
        case "warn":
        case "info":
        case "debug":
        case "trace":
          return true;
        default:
          return false;
      }
    }
    function setLevel(level) {
      const { labels, values } = this.levels;
      if (typeof level === "number") {
        if (labels[level] === void 0) throw Error("unknown level value" + level);
        level = labels[level];
      }
      if (values[level] === void 0) throw Error("unknown level " + level);
      const preLevelVal = this[levelValSym];
      const levelVal = this[levelValSym] = values[level];
      const useOnlyCustomLevelsVal = this[useOnlyCustomLevelsSym];
      const levelComparison = this[levelCompSym];
      const hook = this[hooksSym].logMethod;
      for (const key in values) {
        if (levelComparison(values[key], levelVal) === false) {
          this[key] = noop;
          continue;
        }
        this[key] = isStandardLevel(key, useOnlyCustomLevelsVal) ? levelMethods[key](hook) : genLog(values[key], hook);
      }
      this.emit(
        "level-change",
        level,
        levelVal,
        labels[preLevelVal],
        preLevelVal,
        this
      );
    }
    function getLevel(level) {
      const { levels, levelVal } = this;
      return levels && levels.labels ? levels.labels[levelVal] : "";
    }
    function isLevelEnabled(logLevel) {
      const { values } = this.levels;
      const logLevelVal = values[logLevel];
      return logLevelVal !== void 0 && this[levelCompSym](logLevelVal, this[levelValSym]);
    }
    function compareLevel(direction, current, expected) {
      if (direction === SORTING_ORDER.DESC) {
        return current <= expected;
      }
      return current >= expected;
    }
    function genLevelComparison(levelComparison) {
      if (typeof levelComparison === "string") {
        return compareLevel.bind(null, levelComparison);
      }
      return levelComparison;
    }
    function mappings(customLevels = null, useOnlyCustomLevels = false) {
      const customNums = customLevels ? Object.keys(customLevels).reduce((o, k) => {
        o[customLevels[k]] = k;
        return o;
      }, {}) : null;
      const labels = Object.assign(
        Object.create(Object.prototype, { Infinity: { value: "silent" } }),
        useOnlyCustomLevels ? null : nums,
        customNums
      );
      const values = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      return { labels, values };
    }
    function assertDefaultLevelFound(defaultLevel, customLevels, useOnlyCustomLevels) {
      if (typeof defaultLevel === "number") {
        const values = [].concat(
          Object.keys(customLevels || {}).map((key) => customLevels[key]),
          useOnlyCustomLevels ? [] : Object.keys(nums).map((level) => +level),
          Infinity
        );
        if (!values.includes(defaultLevel)) {
          throw Error(`default level:${defaultLevel} must be included in custom levels`);
        }
        return;
      }
      const labels = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      if (!(defaultLevel in labels)) {
        throw Error(`default level:${defaultLevel} must be included in custom levels`);
      }
    }
    function assertNoLevelCollisions(levels, customLevels) {
      const { labels, values } = levels;
      for (const k in customLevels) {
        if (k in values) {
          throw Error("levels cannot be overridden");
        }
        if (customLevels[k] in labels) {
          throw Error("pre-existing level values cannot be used for new levels");
        }
      }
    }
    function assertLevelComparison(levelComparison) {
      if (typeof levelComparison === "function") {
        return;
      }
      if (typeof levelComparison === "string" && Object.values(SORTING_ORDER).includes(levelComparison)) {
        return;
      }
      throw new Error('Levels comparison should be one of "ASC", "DESC" or "function" type');
    }
    module.exports = {
      initialLsCache,
      genLsCache,
      levelMethods,
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      assertNoLevelCollisions,
      assertDefaultLevelFound,
      genLevelComparison,
      assertLevelComparison
    };
  }
});

// ../../node_modules/pino/lib/meta.js
var require_meta = __commonJS({
  "../../node_modules/pino/lib/meta.js"(exports$1, module) {
    module.exports = { version: "9.14.0" };
  }
});

// ../../node_modules/pino/lib/proto.js
var require_proto = __commonJS({
  "../../node_modules/pino/lib/proto.js"(exports$1, module) {
    var { EventEmitter } = __require("events");
    var {
      lsCacheSym,
      levelValSym,
      setLevelSym,
      getLevelSym,
      chindingsSym,
      parsedChindingsSym,
      mixinSym,
      asJsonSym,
      writeSym,
      mixinMergeStrategySym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      serializersSym,
      formattersSym,
      errorKeySym,
      messageKeySym,
      useOnlyCustomLevelsSym,
      needsMetadataGsym,
      redactFmtSym,
      stringifySym,
      formatOptsSym,
      stringifiersSym,
      msgPrefixSym,
      hooksSym
    } = require_symbols();
    var {
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      initialLsCache,
      genLsCache,
      assertNoLevelCollisions
    } = require_levels();
    var {
      asChindings,
      asJson,
      buildFormatters,
      stringify,
      noop
    } = require_tools();
    var {
      version
    } = require_meta();
    var redaction = require_redaction();
    var constructor = class Pino {
    };
    var prototype = {
      constructor,
      child,
      bindings,
      setBindings,
      flush,
      isLevelEnabled,
      version,
      get level() {
        return this[getLevelSym]();
      },
      set level(lvl) {
        this[setLevelSym](lvl);
      },
      get levelVal() {
        return this[levelValSym];
      },
      set levelVal(n) {
        throw Error("levelVal is read-only");
      },
      get msgPrefix() {
        return this[msgPrefixSym];
      },
      get [Symbol.toStringTag]() {
        return "Pino";
      },
      [lsCacheSym]: initialLsCache,
      [writeSym]: write,
      [asJsonSym]: asJson,
      [getLevelSym]: getLevel,
      [setLevelSym]: setLevel
    };
    Object.setPrototypeOf(prototype, EventEmitter.prototype);
    module.exports = function() {
      return Object.create(prototype);
    };
    var resetChildingsFormatter = (bindings2) => bindings2;
    function child(bindings2, options) {
      if (!bindings2) {
        throw Error("missing bindings for child Pino");
      }
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const instance = Object.create(this);
      if (options == null) {
        if (instance[formattersSym].bindings !== resetChildingsFormatter) {
          instance[formattersSym] = buildFormatters(
            formatters.level,
            resetChildingsFormatter,
            formatters.log
          );
        }
        instance[chindingsSym] = asChindings(instance, bindings2);
        instance[setLevelSym](this.level);
        if (this.onChild !== noop) {
          this.onChild(instance);
        }
        return instance;
      }
      if (options.hasOwnProperty("serializers") === true) {
        instance[serializersSym] = /* @__PURE__ */ Object.create(null);
        for (const k in serializers) {
          instance[serializersSym][k] = serializers[k];
        }
        const parentSymbols = Object.getOwnPropertySymbols(serializers);
        for (var i = 0; i < parentSymbols.length; i++) {
          const ks = parentSymbols[i];
          instance[serializersSym][ks] = serializers[ks];
        }
        for (const bk in options.serializers) {
          instance[serializersSym][bk] = options.serializers[bk];
        }
        const bindingsSymbols = Object.getOwnPropertySymbols(options.serializers);
        for (var bi = 0; bi < bindingsSymbols.length; bi++) {
          const bks = bindingsSymbols[bi];
          instance[serializersSym][bks] = options.serializers[bks];
        }
      } else instance[serializersSym] = serializers;
      if (options.hasOwnProperty("formatters")) {
        const { level, bindings: chindings, log } = options.formatters;
        instance[formattersSym] = buildFormatters(
          level || formatters.level,
          chindings || resetChildingsFormatter,
          log || formatters.log
        );
      } else {
        instance[formattersSym] = buildFormatters(
          formatters.level,
          resetChildingsFormatter,
          formatters.log
        );
      }
      if (options.hasOwnProperty("customLevels") === true) {
        assertNoLevelCollisions(this.levels, options.customLevels);
        instance.levels = mappings(options.customLevels, instance[useOnlyCustomLevelsSym]);
        genLsCache(instance);
      }
      if (typeof options.redact === "object" && options.redact !== null || Array.isArray(options.redact)) {
        instance.redact = options.redact;
        const stringifiers = redaction(instance.redact, stringify);
        const formatOpts = { stringify: stringifiers[redactFmtSym] };
        instance[stringifySym] = stringify;
        instance[stringifiersSym] = stringifiers;
        instance[formatOptsSym] = formatOpts;
      }
      if (typeof options.msgPrefix === "string") {
        instance[msgPrefixSym] = (this[msgPrefixSym] || "") + options.msgPrefix;
      }
      instance[chindingsSym] = asChindings(instance, bindings2);
      const childLevel = options.level || this.level;
      instance[setLevelSym](childLevel);
      this.onChild(instance);
      return instance;
    }
    function bindings() {
      const chindings = this[chindingsSym];
      const chindingsJson = `{${chindings.substr(1)}}`;
      const bindingsFromJson = JSON.parse(chindingsJson);
      delete bindingsFromJson.pid;
      delete bindingsFromJson.hostname;
      return bindingsFromJson;
    }
    function setBindings(newBindings) {
      const chindings = asChindings(this, newBindings);
      this[chindingsSym] = chindings;
      delete this[parsedChindingsSym];
    }
    function defaultMixinMergeStrategy(mergeObject, mixinObject) {
      return Object.assign(mixinObject, mergeObject);
    }
    function write(_obj, msg, num) {
      const t = this[timeSym]();
      const mixin = this[mixinSym];
      const errorKey = this[errorKeySym];
      const messageKey = this[messageKeySym];
      const mixinMergeStrategy = this[mixinMergeStrategySym] || defaultMixinMergeStrategy;
      let obj;
      const streamWriteHook = this[hooksSym].streamWrite;
      if (_obj === void 0 || _obj === null) {
        obj = {};
      } else if (_obj instanceof Error) {
        obj = { [errorKey]: _obj };
        if (msg === void 0) {
          msg = _obj.message;
        }
      } else {
        obj = _obj;
        if (msg === void 0 && _obj[messageKey] === void 0 && _obj[errorKey]) {
          msg = _obj[errorKey].message;
        }
      }
      if (mixin) {
        obj = mixinMergeStrategy(obj, mixin(obj, num, this));
      }
      const s = this[asJsonSym](obj, msg, num, t);
      const stream = this[streamSym];
      if (stream[needsMetadataGsym] === true) {
        stream.lastLevel = num;
        stream.lastObj = obj;
        stream.lastMsg = msg;
        stream.lastTime = t.slice(this[timeSliceIndexSym]);
        stream.lastLogger = this;
      }
      stream.write(streamWriteHook ? streamWriteHook(s) : s);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw Error("callback must be a function");
      }
      const stream = this[streamSym];
      if (typeof stream.flush === "function") {
        stream.flush(cb || noop);
      } else if (cb) cb();
    }
  }
});

// ../../node_modules/safe-stable-stringify/index.js
var require_safe_stable_stringify = __commonJS({
  "../../node_modules/safe-stable-stringify/index.js"(exports$1, module) {
    var { hasOwnProperty } = Object.prototype;
    var stringify = configure();
    stringify.configure = configure;
    stringify.stringify = stringify;
    stringify.default = stringify;
    exports$1.stringify = stringify;
    exports$1.configure = configure;
    module.exports = stringify;
    var strEscapeSequencesRegExp = /[\u0000-\u001f\u0022\u005c\ud800-\udfff]/;
    function strEscape(str) {
      if (str.length < 5e3 && !strEscapeSequencesRegExp.test(str)) {
        return `"${str}"`;
      }
      return JSON.stringify(str);
    }
    function sort(array, comparator) {
      if (array.length > 200 || comparator) {
        return array.sort(comparator);
      }
      for (let i = 1; i < array.length; i++) {
        const currentValue = array[i];
        let position = i;
        while (position !== 0 && array[position - 1] > currentValue) {
          array[position] = array[position - 1];
          position--;
        }
        array[position] = currentValue;
      }
      return array;
    }
    var typedArrayPrototypeGetSymbolToStringTag = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(
        Object.getPrototypeOf(
          new Int8Array()
        )
      ),
      Symbol.toStringTag
    ).get;
    function isTypedArrayWithEntries(value) {
      return typedArrayPrototypeGetSymbolToStringTag.call(value) !== void 0 && value.length !== 0;
    }
    function stringifyTypedArray(array, separator, maximumBreadth) {
      if (array.length < maximumBreadth) {
        maximumBreadth = array.length;
      }
      const whitespace = separator === "," ? "" : " ";
      let res = `"0":${whitespace}${array[0]}`;
      for (let i = 1; i < maximumBreadth; i++) {
        res += `${separator}"${i}":${whitespace}${array[i]}`;
      }
      return res;
    }
    function getCircularValueOption(options) {
      if (hasOwnProperty.call(options, "circularValue")) {
        const circularValue = options.circularValue;
        if (typeof circularValue === "string") {
          return `"${circularValue}"`;
        }
        if (circularValue == null) {
          return circularValue;
        }
        if (circularValue === Error || circularValue === TypeError) {
          return {
            toString() {
              throw new TypeError("Converting circular structure to JSON");
            }
          };
        }
        throw new TypeError('The "circularValue" argument must be of type string or the value null or undefined');
      }
      return '"[Circular]"';
    }
    function getDeterministicOption(options) {
      let value;
      if (hasOwnProperty.call(options, "deterministic")) {
        value = options.deterministic;
        if (typeof value !== "boolean" && typeof value !== "function") {
          throw new TypeError('The "deterministic" argument must be of type boolean or comparator function');
        }
      }
      return value === void 0 ? true : value;
    }
    function getBooleanOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "boolean") {
          throw new TypeError(`The "${key}" argument must be of type boolean`);
        }
      }
      return value === void 0 ? true : value;
    }
    function getPositiveIntegerOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "number") {
          throw new TypeError(`The "${key}" argument must be of type number`);
        }
        if (!Number.isInteger(value)) {
          throw new TypeError(`The "${key}" argument must be an integer`);
        }
        if (value < 1) {
          throw new RangeError(`The "${key}" argument must be >= 1`);
        }
      }
      return value === void 0 ? Infinity : value;
    }
    function getItemCount(number) {
      if (number === 1) {
        return "1 item";
      }
      return `${number} items`;
    }
    function getUniqueReplacerSet(replacerArray) {
      const replacerSet = /* @__PURE__ */ new Set();
      for (const value of replacerArray) {
        if (typeof value === "string" || typeof value === "number") {
          replacerSet.add(String(value));
        }
      }
      return replacerSet;
    }
    function getStrictOption(options) {
      if (hasOwnProperty.call(options, "strict")) {
        const value = options.strict;
        if (typeof value !== "boolean") {
          throw new TypeError('The "strict" argument must be of type boolean');
        }
        if (value) {
          return (value2) => {
            let message = `Object can not safely be stringified. Received type ${typeof value2}`;
            if (typeof value2 !== "function") message += ` (${value2.toString()})`;
            throw new Error(message);
          };
        }
      }
    }
    function configure(options) {
      options = { ...options };
      const fail = getStrictOption(options);
      if (fail) {
        if (options.bigint === void 0) {
          options.bigint = false;
        }
        if (!("circularValue" in options)) {
          options.circularValue = Error;
        }
      }
      const circularValue = getCircularValueOption(options);
      const bigint = getBooleanOption(options, "bigint");
      const deterministic = getDeterministicOption(options);
      const comparator = typeof deterministic === "function" ? deterministic : void 0;
      const maximumDepth = getPositiveIntegerOption(options, "maximumDepth");
      const maximumBreadth = getPositiveIntegerOption(options, "maximumBreadth");
      function stringifyFnReplacer(key, parent, stack, replacer, spacer, indentation) {
        let value = parent[key];
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        value = replacer.call(parent, key, value);
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            let join = ",";
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let whitespace = "";
            let separator = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (deterministic && !isTypedArrayWithEntries(value)) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyFnReplacer(key2, value, stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyArrayReplacer(key, value, stack, replacer, spacer, indentation) {
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            let res = "";
            let join = ",";
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            stack.push(value);
            let whitespace = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            let separator = "";
            for (const key2 of replacer) {
              const tmp = stringifyArrayReplacer(key2, value[key2], stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyIndent(key, value, stack, spacer, indentation) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifyIndent(key, value, stack, spacer, indentation);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              indentation += spacer;
              let res2 = `
${indentation}`;
              const join2 = `,
${indentation}`;
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyIndent(String(i), value[i], stack, spacer, indentation);
                res2 += tmp2 !== void 0 ? tmp2 : "null";
                res2 += join2;
              }
              const tmp = stringifyIndent(String(i), value[i], stack, spacer, indentation);
              res2 += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res2 += `${join2}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              res2 += `
${originalIndentation}`;
              stack.pop();
              return `[${res2}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            indentation += spacer;
            const join = `,
${indentation}`;
            let res = "";
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, join, maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = join;
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyIndent(key2, value[key2], stack, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}: ${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (separator !== "") {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifySimple(key, value, stack) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifySimple(key, value, stack);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            const hasLength = value.length !== void 0;
            if (hasLength && Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifySimple(String(i), value[i], stack);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += ",";
              }
              const tmp = stringifySimple(String(i), value[i], stack);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `,"... ${getItemCount(removedKeys)} not stringified"`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (hasLength && isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, ",", maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = ",";
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifySimple(key2, value[key2], stack);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${tmp}`;
                separator = ",";
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringify2(value, replacer, space) {
        if (arguments.length > 1) {
          let spacer = "";
          if (typeof space === "number") {
            spacer = " ".repeat(Math.min(space, 10));
          } else if (typeof space === "string") {
            spacer = space.slice(0, 10);
          }
          if (replacer != null) {
            if (typeof replacer === "function") {
              return stringifyFnReplacer("", { "": value }, [], replacer, spacer, "");
            }
            if (Array.isArray(replacer)) {
              return stringifyArrayReplacer("", value, [], getUniqueReplacerSet(replacer), spacer, "");
            }
          }
          if (spacer.length !== 0) {
            return stringifyIndent("", value, [], spacer, "");
          }
        }
        return stringifySimple("", value, []);
      }
      return stringify2;
    }
  }
});

// ../../node_modules/pino/lib/multistream.js
var require_multistream = __commonJS({
  "../../node_modules/pino/lib/multistream.js"(exports$1, module) {
    var metadata = /* @__PURE__ */ Symbol.for("pino.metadata");
    var { DEFAULT_LEVELS } = require_constants();
    var DEFAULT_INFO_LEVEL = DEFAULT_LEVELS.info;
    function multistream(streamsArray, opts) {
      streamsArray = streamsArray || [];
      opts = opts || { dedupe: false };
      const streamLevels = Object.create(DEFAULT_LEVELS);
      streamLevels.silent = Infinity;
      if (opts.levels && typeof opts.levels === "object") {
        Object.keys(opts.levels).forEach((i) => {
          streamLevels[i] = opts.levels[i];
        });
      }
      const res = {
        write,
        add,
        remove,
        emit,
        flushSync,
        end,
        minLevel: 0,
        lastId: 0,
        streams: [],
        clone,
        [metadata]: true,
        streamLevels
      };
      if (Array.isArray(streamsArray)) {
        streamsArray.forEach(add, res);
      } else {
        add.call(res, streamsArray);
      }
      streamsArray = null;
      return res;
      function write(data) {
        let dest;
        const level = this.lastLevel;
        const { streams } = this;
        let recordedLevel = 0;
        let stream;
        for (let i = initLoopVar(streams.length, opts.dedupe); checkLoopVar(i, streams.length, opts.dedupe); i = adjustLoopVar(i, opts.dedupe)) {
          dest = streams[i];
          if (dest.level <= level) {
            if (recordedLevel !== 0 && recordedLevel !== dest.level) {
              break;
            }
            stream = dest.stream;
            if (stream[metadata]) {
              const { lastTime, lastMsg, lastObj, lastLogger } = this;
              stream.lastLevel = level;
              stream.lastTime = lastTime;
              stream.lastMsg = lastMsg;
              stream.lastObj = lastObj;
              stream.lastLogger = lastLogger;
            }
            stream.write(data);
            if (opts.dedupe) {
              recordedLevel = dest.level;
            }
          } else if (!opts.dedupe) {
            break;
          }
        }
      }
      function emit(...args) {
        for (const { stream } of this.streams) {
          if (typeof stream.emit === "function") {
            stream.emit(...args);
          }
        }
      }
      function flushSync() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
        }
      }
      function add(dest) {
        if (!dest) {
          return res;
        }
        const isStream = typeof dest.write === "function" || dest.stream;
        const stream_ = dest.write ? dest : dest.stream;
        if (!isStream) {
          throw Error("stream object needs to implement either StreamEntry or DestinationStream interface");
        }
        const { streams, streamLevels: streamLevels2 } = this;
        let level;
        if (typeof dest.levelVal === "number") {
          level = dest.levelVal;
        } else if (typeof dest.level === "string") {
          level = streamLevels2[dest.level];
        } else if (typeof dest.level === "number") {
          level = dest.level;
        } else {
          level = DEFAULT_INFO_LEVEL;
        }
        const dest_ = {
          stream: stream_,
          level,
          levelVal: void 0,
          id: ++res.lastId
        };
        streams.unshift(dest_);
        streams.sort(compareByLevel);
        this.minLevel = streams[0].level;
        return res;
      }
      function remove(id) {
        const { streams } = this;
        const index = streams.findIndex((s) => s.id === id);
        if (index >= 0) {
          streams.splice(index, 1);
          streams.sort(compareByLevel);
          this.minLevel = streams.length > 0 ? streams[0].level : -1;
        }
        return res;
      }
      function end() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
          stream.end();
        }
      }
      function clone(level) {
        const streams = new Array(this.streams.length);
        for (let i = 0; i < streams.length; i++) {
          streams[i] = {
            level,
            stream: this.streams[i].stream
          };
        }
        return {
          write,
          add,
          remove,
          minLevel: level,
          streams,
          clone,
          emit,
          flushSync,
          [metadata]: true
        };
      }
    }
    function compareByLevel(a, b) {
      return a.level - b.level;
    }
    function initLoopVar(length, dedupe) {
      return dedupe ? length - 1 : 0;
    }
    function adjustLoopVar(i, dedupe) {
      return dedupe ? i - 1 : i + 1;
    }
    function checkLoopVar(i, length, dedupe) {
      return dedupe ? i >= 0 : i < length;
    }
    module.exports = multistream;
  }
});

// ../../node_modules/pino/pino.js
var require_pino = __commonJS({
  "../../node_modules/pino/pino.js"(exports$1, module) {
    var os = __require("os");
    var stdSerializers = require_pino_std_serializers();
    var caller = require_caller();
    var redaction = require_redaction();
    var time = require_time();
    var proto = require_proto();
    var symbols = require_symbols();
    var { configure } = require_safe_stable_stringify();
    var { assertDefaultLevelFound, mappings, genLsCache, genLevelComparison, assertLevelComparison } = require_levels();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var {
      createArgsNormalizer,
      asChindings,
      buildSafeSonicBoom,
      buildFormatters,
      stringify,
      normalizeDestFileDescriptor,
      noop
    } = require_tools();
    var { version } = require_meta();
    var {
      chindingsSym,
      redactFmtSym,
      serializersSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      setLevelSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      mixinSym,
      levelCompSym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    } = symbols;
    var { epochTime, nullTime } = time;
    var { pid } = process;
    var hostname = os.hostname();
    var defaultErrorSerializer = stdSerializers.err;
    var defaultOptions = {
      level: "info",
      levelComparison: SORTING_ORDER.ASC,
      levels: DEFAULT_LEVELS,
      messageKey: "msg",
      errorKey: "err",
      nestedKey: null,
      enabled: true,
      base: { pid, hostname },
      serializers: Object.assign(/* @__PURE__ */ Object.create(null), {
        err: defaultErrorSerializer
      }),
      formatters: Object.assign(/* @__PURE__ */ Object.create(null), {
        bindings(bindings) {
          return bindings;
        },
        level(label, number) {
          return { level: number };
        }
      }),
      hooks: {
        logMethod: void 0,
        streamWrite: void 0
      },
      timestamp: epochTime,
      name: void 0,
      redact: null,
      customLevels: null,
      useOnlyCustomLevels: false,
      depthLimit: 5,
      edgeLimit: 100
    };
    var normalize = createArgsNormalizer(defaultOptions);
    var serializers = Object.assign(/* @__PURE__ */ Object.create(null), stdSerializers);
    function pino2(...args) {
      const instance = {};
      const { opts, stream } = normalize(instance, caller(), ...args);
      if (opts.level && typeof opts.level === "string" && DEFAULT_LEVELS[opts.level.toLowerCase()] !== void 0) opts.level = opts.level.toLowerCase();
      const {
        redact,
        crlf,
        serializers: serializers2,
        timestamp,
        messageKey,
        errorKey,
        nestedKey,
        base,
        name,
        level,
        customLevels,
        levelComparison,
        mixin,
        mixinMergeStrategy,
        useOnlyCustomLevels,
        formatters,
        hooks,
        depthLimit,
        edgeLimit,
        onChild,
        msgPrefix
      } = opts;
      const stringifySafe = configure({
        maximumDepth: depthLimit,
        maximumBreadth: edgeLimit
      });
      const allFormatters = buildFormatters(
        formatters.level,
        formatters.bindings,
        formatters.log
      );
      const stringifyFn = stringify.bind({
        [stringifySafeSym]: stringifySafe
      });
      const stringifiers = redact ? redaction(redact, stringifyFn) : {};
      const formatOpts = redact ? { stringify: stringifiers[redactFmtSym] } : { stringify: stringifyFn };
      const end = "}" + (crlf ? "\r\n" : "\n");
      const coreChindings = asChindings.bind(null, {
        [chindingsSym]: "",
        [serializersSym]: serializers2,
        [stringifiersSym]: stringifiers,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [formattersSym]: allFormatters
      });
      let chindings = "";
      if (base !== null) {
        if (name === void 0) {
          chindings = coreChindings(base);
        } else {
          chindings = coreChindings(Object.assign({}, base, { name }));
        }
      }
      const time2 = timestamp instanceof Function ? timestamp : timestamp ? epochTime : nullTime;
      const timeSliceIndex = time2().indexOf(":") + 1;
      if (useOnlyCustomLevels && !customLevels) throw Error("customLevels is required if useOnlyCustomLevels is set true");
      if (mixin && typeof mixin !== "function") throw Error(`Unknown mixin type "${typeof mixin}" - expected "function"`);
      if (msgPrefix && typeof msgPrefix !== "string") throw Error(`Unknown msgPrefix type "${typeof msgPrefix}" - expected "string"`);
      assertDefaultLevelFound(level, customLevels, useOnlyCustomLevels);
      const levels = mappings(customLevels, useOnlyCustomLevels);
      if (typeof stream.emit === "function") {
        stream.emit("message", { code: "PINO_CONFIG", config: { levels, messageKey, errorKey } });
      }
      assertLevelComparison(levelComparison);
      const levelCompFunc = genLevelComparison(levelComparison);
      Object.assign(instance, {
        levels,
        [levelCompSym]: levelCompFunc,
        [useOnlyCustomLevelsSym]: useOnlyCustomLevels,
        [streamSym]: stream,
        [timeSym]: time2,
        [timeSliceIndexSym]: timeSliceIndex,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [stringifiersSym]: stringifiers,
        [endSym]: end,
        [formatOptsSym]: formatOpts,
        [messageKeySym]: messageKey,
        [errorKeySym]: errorKey,
        [nestedKeySym]: nestedKey,
        // protect against injection
        [nestedKeyStrSym]: nestedKey ? `,${JSON.stringify(nestedKey)}:{` : "",
        [serializersSym]: serializers2,
        [mixinSym]: mixin,
        [mixinMergeStrategySym]: mixinMergeStrategy,
        [chindingsSym]: chindings,
        [formattersSym]: allFormatters,
        [hooksSym]: hooks,
        silent: noop,
        onChild,
        [msgPrefixSym]: msgPrefix
      });
      Object.setPrototypeOf(instance, proto());
      genLsCache(instance);
      instance[setLevelSym](level);
      return instance;
    }
    module.exports = pino2;
    module.exports.destination = (dest = process.stdout.fd) => {
      if (typeof dest === "object") {
        dest.dest = normalizeDestFileDescriptor(dest.dest || process.stdout.fd);
        return buildSafeSonicBoom(dest);
      } else {
        return buildSafeSonicBoom({ dest: normalizeDestFileDescriptor(dest), minLength: 0 });
      }
    };
    module.exports.transport = require_transport();
    module.exports.multistream = require_multistream();
    module.exports.levels = mappings();
    module.exports.stdSerializers = serializers;
    module.exports.stdTimeFunctions = Object.assign({}, time);
    module.exports.symbols = symbols;
    module.exports.version = version;
    module.exports.default = pino2;
    module.exports.pino = pino2;
  }
});

// ../../node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") ; else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../core/src/types/config.ts
var EnvironmentSchema = external_exports.enum(["dev", "stage", "prod"]).default("prod");
var ChannelTypeSchema = external_exports.enum(["sms", "voice"]);
var TACConfigSchema = external_exports.object({
  environment: EnvironmentSchema,
  twilioAccountSid: external_exports.string().min(1, "Twilio Account SID is required"),
  twilioAuthToken: external_exports.string().min(1, "Twilio Auth Token is required"),
  twilioPhoneNumber: external_exports.string().min(1, "Twilio Phone Number is required"),
  memoryStoreId: external_exports.string().regex(/^mem_(service|store)_[0-9a-z]{26}$/, "Invalid Memory Store ID format").optional(),
  memoryApiKey: external_exports.string().optional(),
  memoryApiToken: external_exports.string().optional(),
  traitGroups: external_exports.array(external_exports.string()).optional(),
  conversationServiceId: external_exports.string().regex(
    /^(comms_service|conv_configuration)_[0-9a-z]{26}$/,
    "Invalid Conversation Configuration ID format"
  ),
  voicePublicDomain: external_exports.string().url().optional(),
  cintelConfigurationId: external_exports.string().optional(),
  cintelObservationOperatorSid: external_exports.string().optional(),
  cintelSummaryOperatorSid: external_exports.string().optional()
});
var EnvironmentVariables = {
  ENVIRONMENT: "ENVIRONMENT",
  TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID",
  TWILIO_AUTH_TOKEN: "TWILIO_AUTH_TOKEN",
  TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER",
  MEMORY_STORE_ID: "MEMORY_STORE_ID",
  MEMORY_API_KEY: "MEMORY_API_KEY",
  MEMORY_API_TOKEN: "MEMORY_API_TOKEN",
  TRAIT_GROUPS: "TRAIT_GROUPS",
  CONVERSATION_SERVICE_ID: "CONVERSATION_SERVICE_ID",
  VOICE_PUBLIC_DOMAIN: "VOICE_PUBLIC_DOMAIN",
  TWILIO_TAC_CI_CONFIGURATION_ID: "TWILIO_TAC_CI_CONFIGURATION_ID",
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: "TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID",
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: "TWILIO_TAC_CI_SUMMARY_OPERATOR_SID"
};
function computeServiceUrls(environment) {
  const baseUrls = {
    dev: {
      memoryApiUrl: "https://memory.dev-us1.twilio.com",
      conversationsApiUrl: "https://conversations.dev-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.dev.twilio.com"
    },
    stage: {
      memoryApiUrl: "https://memory.stage-us1.twilio.com",
      conversationsApiUrl: "https://conversations.stage-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.stage.twilio.com"
    },
    prod: {
      memoryApiUrl: "https://memory.twilio.com",
      conversationsApiUrl: "https://conversations.twilio.com",
      knowledgeApiUrl: "https://knowledge.twilio.com"
    }
  };
  return baseUrls[environment];
}

// ../core/src/types/conversation.ts
var ParticipantAddressTypeSchema = external_exports.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var ParticipantAddressSchema = external_exports.object({
  channel: ParticipantAddressTypeSchema,
  address: external_exports.string().min(1, "Address is required"),
  channel_id: external_exports.string().nullable().optional()
});
var CommunicationParticipantSchema = external_exports.object({
  address: external_exports.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participant_id: external_exports.string(),
  delivery_status: external_exports.enum(["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]).optional()
});
var TranscriptionWordSchema = external_exports.object({
  text: external_exports.string(),
  startTime: external_exports.string().optional(),
  endTime: external_exports.string().optional()
});
var TranscriptionSchema = external_exports.object({
  channel: external_exports.number().optional(),
  confidence: external_exports.number().min(0).max(1).optional(),
  engine: external_exports.string().optional(),
  words: external_exports.array(TranscriptionWordSchema).optional()
});
var CommunicationContentSchema = external_exports.object({
  type: external_exports.enum(["TEXT", "TRANSCRIPTION"]),
  text: external_exports.string().max(8388608),
  transcription: TranscriptionSchema.optional()
});
var CommunicationSchema = external_exports.object({
  id: external_exports.string(),
  conversation_id: external_exports.string(),
  account_id: external_exports.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: external_exports.array(CommunicationParticipantSchema),
  channel_id: external_exports.string().optional(),
  created_at: external_exports.string().optional(),
  updated_at: external_exports.string().optional()
});
var AuthorInfoSchema = external_exports.object({
  address: external_exports.string(),
  participant_id: external_exports.string().optional()
});
var ConversationSessionSchema = external_exports.object({
  conversation_id: external_exports.string().min(1, "Conversation ID is required"),
  profile_id: external_exports.string().optional(),
  service_id: external_exports.string().optional(),
  channel: ChannelTypeSchema,
  started_at: external_exports.date(),
  author_info: AuthorInfoSchema.optional(),
  profile: external_exports.custom().optional(),
  metadata: external_exports.record(external_exports.unknown()).optional().default({})
});
function isConversationId(value) {
  return value.length > 0;
}
function isProfileId(value) {
  return value.length > 0;
}
function isParticipantId(value) {
  return value.length > 0;
}
var ConversationResponseSchema = external_exports.object({
  id: external_exports.string(),
  accountId: external_exports.string(),
  status: external_exports.string().optional(),
  name: external_exports.string().nullish(),
  // API returns null when not set
  configurationId: external_exports.string().optional(),
  createdAt: external_exports.string().optional(),
  updatedAt: external_exports.string().optional()
});
var ConversationAddressSchema = external_exports.object({
  channel: ParticipantAddressTypeSchema,
  address: external_exports.string(),
  channelId: external_exports.string().nullish()
  // API returns null when not set
});
var ConversationParticipantSchema = external_exports.object({
  id: external_exports.string(),
  conversationId: external_exports.string(),
  accountId: external_exports.string(),
  name: external_exports.string().optional(),
  type: external_exports.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]).optional(),
  profileId: external_exports.string().nullable().optional(),
  addresses: external_exports.array(ConversationAddressSchema).default([]),
  createdAt: external_exports.string().optional(),
  updatedAt: external_exports.string().optional()
});

// ../core/src/types/tac.ts
var TACChannelTypeSchema = external_exports.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var TACDeliveryStatusSchema = external_exports.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var TACParticipantTypeSchema = external_exports.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var TACCommunicationAuthorSchema = external_exports.object({
  // Common fields (both APIs)
  address: external_exports.string(),
  channel: TACChannelTypeSchema,
  // Maestro-only fields
  participant_id: external_exports.string().optional(),
  delivery_status: TACDeliveryStatusSchema.optional(),
  // Memory-only fields
  id: external_exports.string().optional(),
  name: external_exports.string().optional(),
  type: TACParticipantTypeSchema.optional(),
  profile_id: external_exports.string().optional()
});
var TACCommunicationContentSchema = external_exports.object({
  // Maestro-only: content type discriminator
  type: external_exports.enum(["TEXT", "TRANSCRIPTION"]).optional(),
  // Both APIs: message text (optional in unified model to handle both)
  text: external_exports.string().optional(),
  // Maestro-only: transcription metadata
  transcription: TranscriptionSchema.optional()
});
var TACCommunicationSchema = external_exports.object({
  // Common fields (both APIs)
  id: external_exports.string(),
  author: TACCommunicationAuthorSchema,
  content: TACCommunicationContentSchema,
  recipients: external_exports.array(TACCommunicationAuthorSchema).default([]),
  channel_id: external_exports.string().optional(),
  created_at: external_exports.string().optional(),
  updated_at: external_exports.string().optional(),
  // Maestro-only fields
  conversation_id: external_exports.string().optional(),
  account_id: external_exports.string().optional()
});

// ../core/src/lib/tac-memory-response.ts
function isMemoryRetrievalResponse(data) {
  return !Array.isArray(data);
}
var TACMemoryResponse = class {
  _data;
  _communications;
  /**
   * Initialize wrapper with either Memory or Maestro data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Maestro)
   */
  constructor(data) {
    this._data = data;
    if (isMemoryRetrievalResponse(data)) {
      this._communications = (data.communications ?? []).map(
        (comm) => TACCommunicationSchema.parse(comm)
      );
    } else {
      this._communications = data.map((comm) => TACCommunicationSchema.parse(comm));
    }
  }
  /**
   * Get observation memories.
   *
   * @returns List of observations if Memory is configured, empty array for Maestro fallback
   */
  get observations() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.observations;
    }
    return [];
  }
  /**
   * Get summary memories.
   *
   * @returns List of summaries if Memory is configured, empty array for Maestro fallback
   */
  get summaries() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.summaries;
    }
    return [];
  }
  /**
   * Get communications in unified format with all available fields.
   *
   * Communications are converted to a common format during initialization that includes
   * all fields from both Memory and Maestro APIs. Fields not available from a particular
   * API will be undefined.
   *
   * @returns List of unified communications with all available fields
   */
  get communications() {
    return this._communications;
  }
  /**
   * Check if Memory API is configured and providing full features.
   *
   * @returns true if Memory is configured (observations/summaries available),
   *          false if using Maestro fallback (only communications available)
   */
  get hasMemoryFeatures() {
    return isMemoryRetrievalResponse(this._data);
  }
  /**
   * Access raw underlying data for advanced use cases.
   *
   * Use this when you need access to all fields from the original API responses,
   * not just the unified common fields.
   *
   * @returns Either MemoryRetrievalResponse or Communication[] depending on configuration
   */
  get rawData() {
    return this._data;
  }
};

// ../core/src/lib/config.ts
var import_dotenv = __toESM(require_main());

// ../core/src/types/memory.ts
var MessageDirectionSchema = external_exports.enum(["inbound", "outbound"]);
var MemoryChannelTypeSchema = external_exports.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var MemoryParticipantTypeSchema = external_exports.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var MemoryDeliveryStatusSchema = external_exports.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var MemoryParticipantSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string().max(256),
  address: external_exports.string().max(254),
  channel: MemoryChannelTypeSchema,
  type: MemoryParticipantTypeSchema.optional(),
  profile_id: external_exports.string().optional(),
  delivery_status: MemoryDeliveryStatusSchema.optional()
});
var MemoryCommunicationContentSchema = external_exports.object({
  text: external_exports.string().max(8388608).optional()
});
var MemoryCommunicationSchema = external_exports.object({
  id: external_exports.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: external_exports.array(MemoryParticipantSchema).max(100),
  channel_id: external_exports.string().max(256).optional(),
  created_at: external_exports.string(),
  updated_at: external_exports.string().optional()
});
var SessionMessageSchema = external_exports.object({
  direction: MessageDirectionSchema,
  channel: external_exports.string(),
  from_address: external_exports.string().optional(),
  to_address: external_exports.string().optional(),
  content: external_exports.string(),
  timestamp: external_exports.string().datetime()
});
var SessionInfoSchema = external_exports.object({
  session_id: external_exports.string(),
  started_at: external_exports.string().datetime(),
  ended_at: external_exports.string().datetime().optional(),
  channel: external_exports.string(),
  messages: external_exports.array(SessionMessageSchema)
});
var ObservationInfoSchema = external_exports.object({
  id: external_exports.string(),
  content: external_exports.string(),
  createdAt: external_exports.string().datetime(),
  occurredAt: external_exports.string().datetime().optional(),
  updatedAt: external_exports.string().datetime().optional(),
  conversationIds: external_exports.array(external_exports.string()).nullable().optional(),
  source: external_exports.string().optional()
});
var SummaryInfoSchema = external_exports.object({
  id: external_exports.string(),
  content: external_exports.string(),
  createdAt: external_exports.string().datetime(),
  updatedAt: external_exports.string().datetime().optional(),
  conversationIds: external_exports.array(external_exports.string()).optional()
});
var MemoryRetrievalRequestSchema = external_exports.object({
  query: external_exports.string().optional(),
  start_date: external_exports.string().datetime().optional(),
  end_date: external_exports.string().datetime().optional(),
  observation_limit: external_exports.number().int().positive().optional().default(10),
  summary_limit: external_exports.number().int().positive().optional().default(5),
  session_limit: external_exports.number().int().positive().optional().default(3)
});
var MemoryRetrievalResponseSchema = external_exports.object({
  observations: external_exports.array(ObservationInfoSchema),
  summaries: external_exports.array(SummaryInfoSchema),
  communications: external_exports.array(MemoryCommunicationSchema).optional().default([]),
  meta: external_exports.object({
    queryTime: external_exports.number().optional()
  }).optional()
});
var ProfileLookupResponseSchema = external_exports.object({
  normalizedValue: external_exports.string().max(255),
  profiles: external_exports.array(external_exports.string()).max(100)
});
var ProfileResponseSchema = external_exports.object({
  id: external_exports.string(),
  createdAt: external_exports.string(),
  traits: external_exports.record(external_exports.unknown())
});
var EMPTY_MEMORY_RESPONSE = {
  observations: [],
  summaries: [],
  communications: []
};
var CreateObservationResponseSchema = external_exports.object({
  content: external_exports.string(),
  source: external_exports.string(),
  occurredAt: external_exports.string(),
  conversationIds: external_exports.array(external_exports.string())
});
var CreateConversationSummariesResponseSchema = external_exports.object({
  message: external_exports.string()
});

// ../core/src/types/voice.ts
var VoiceServerConfigSchema = external_exports.object({
  host: external_exports.string().default("0.0.0.0"),
  port: external_exports.number().int().positive().default(3e3),
  path: external_exports.string().default("/twiml"),
  webhookPath: external_exports.string().default("/voice")
});
var CustomParametersSchema = external_exports.object({
  conversation_id: external_exports.string().optional(),
  profile_id: external_exports.string().optional(),
  customer_participant_id: external_exports.string().optional(),
  ai_agent_participant_id: external_exports.string().optional()
});
var SetupMessageSchema = external_exports.object({
  type: external_exports.literal("setup"),
  sessionId: external_exports.string(),
  callSid: external_exports.string(),
  parentCallSid: external_exports.string().optional(),
  from: external_exports.string(),
  to: external_exports.string(),
  forwardedFrom: external_exports.string().optional(),
  callerName: external_exports.string().optional(),
  direction: external_exports.string(),
  callType: external_exports.string(),
  callStatus: external_exports.string(),
  accountSid: external_exports.string(),
  customParameters: external_exports.record(external_exports.unknown()).optional()
});
var PromptMessageSchema = external_exports.object({
  type: external_exports.literal("prompt"),
  voicePrompt: external_exports.string(),
  lang: external_exports.string().optional(),
  last: external_exports.boolean().optional(),
  agentSpeaking: external_exports.string().optional()
});
var InterruptMessageSchema = external_exports.object({
  type: external_exports.literal("interrupt"),
  reason: external_exports.string().optional(),
  transcript: external_exports.string().optional()
});
var WebSocketMessageSchema = external_exports.union([
  SetupMessageSchema,
  PromptMessageSchema,
  InterruptMessageSchema
]);
var VoiceResponseSchema = external_exports.object({
  type: external_exports.literal("text"),
  token: external_exports.string(),
  last: external_exports.boolean().optional().default(true)
});
var ConversationRelayCallbackPayloadSchema = external_exports.object({
  AccountSid: external_exports.string(),
  CallSid: external_exports.string(),
  CallStatus: external_exports.string(),
  // 'in-progress', 'completed', 'busy', 'no-answer', 'failed'
  From: external_exports.string(),
  To: external_exports.string(),
  Direction: external_exports.string().optional(),
  SessionId: external_exports.string().optional(),
  SessionStatus: external_exports.string().optional(),
  SessionDuration: external_exports.string().optional(),
  HandoffData: external_exports.string().optional()
  // JSON string
});
var HandoffDataSchema = external_exports.object({
  reason: external_exports.string(),
  call_summary: external_exports.string(),
  sentiment: external_exports.string()
});

// ../core/src/types/tools.ts
var JSONSchemaSchema = external_exports.object({
  type: external_exports.enum(["object", "string", "number", "boolean", "array"]),
  properties: external_exports.record(external_exports.any()).optional(),
  required: external_exports.array(external_exports.string()).optional(),
  items: external_exports.any().optional(),
  enum: external_exports.array(external_exports.any()).optional(),
  description: external_exports.string().optional()
});
var OpenAIToolSchema = external_exports.object({
  type: external_exports.literal("function"),
  function: external_exports.object({
    name: external_exports.string(),
    description: external_exports.string(),
    parameters: JSONSchemaSchema
  })
});
var ToolExecutionResultSchema = external_exports.object({
  success: external_exports.boolean(),
  data: external_exports.any().optional(),
  error: external_exports.string().optional(),
  metadata: external_exports.record(external_exports.unknown()).optional()
});
var BuiltInTools = {
  RETRIEVE_MEMORY: "retrieve_profile_memory",
  SEND_MESSAGE: "send_message",
  ESCALATE_TO_HUMAN: "escalate_to_human",
  SEARCH_KNOWLEDGE: "search_knowledge"
};

// ../core/src/types/cintel.ts
var CintelParticipantSchema = external_exports.object({
  type: external_exports.string(),
  profileId: external_exports.string().optional(),
  mediaParticipantId: external_exports.string().optional()
});
var ExecutionDetailsSchema = external_exports.object({
  participants: external_exports.array(CintelParticipantSchema).optional()
});
var OperatorSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string().optional()
});
var OperatorResultSchema = external_exports.object({
  id: external_exports.string(),
  operator: OperatorSchema,
  outputFormat: external_exports.string(),
  result: external_exports.unknown(),
  dateCreated: external_exports.string(),
  referenceIds: external_exports.array(external_exports.string()).optional().default([]),
  executionDetails: ExecutionDetailsSchema.optional()
});
var IntelligenceConfigurationSchema = external_exports.object({
  id: external_exports.string(),
  friendlyName: external_exports.string().optional()
});
var OperatorResultEventSchema = external_exports.object({
  accountId: external_exports.string(),
  conversationId: external_exports.string(),
  memoryStoreId: external_exports.string().optional(),
  intelligenceConfiguration: IntelligenceConfigurationSchema,
  operatorResults: external_exports.array(OperatorResultSchema)
});
var OperatorProcessingResultSchema = external_exports.object({
  success: external_exports.boolean(),
  eventType: external_exports.string().optional(),
  skipped: external_exports.boolean().default(false),
  skipReason: external_exports.string().optional(),
  error: external_exports.string().optional(),
  createdCount: external_exports.number().default(0)
});
var ConversationIntelligenceConfigSchema = external_exports.object({
  configurationId: external_exports.string(),
  observationOperatorSid: external_exports.string().optional(),
  summaryOperatorSid: external_exports.string().optional()
});
var ConversationSummaryItemSchema = external_exports.object({
  content: external_exports.string(),
  conversationId: external_exports.string(),
  occurredAt: external_exports.string(),
  source: external_exports.string().optional()
});

// ../core/src/types/knowledge.ts
var KnowledgeBaseStatusSchema = external_exports.enum([
  "QUEUED",
  "PROVISIONING",
  "ACTIVE",
  "FAILED",
  "DELETING"
]);
var KnowledgeBaseSchema = external_exports.object({
  id: external_exports.string(),
  displayName: external_exports.string(),
  description: external_exports.string(),
  status: KnowledgeBaseStatusSchema,
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  version: external_exports.number()
});
var KnowledgeChunkResultSchema = external_exports.object({
  content: external_exports.string(),
  knowledgeId: external_exports.string(),
  createdAt: external_exports.string(),
  score: external_exports.number().optional()
});
var KnowledgeSearchResponseSchema = external_exports.object({
  chunks: external_exports.array(KnowledgeChunkResultSchema)
});

// ../core/src/lib/config.ts
var TACConfig = class _TACConfig {
  environment;
  twilioAccountSid;
  twilioAuthToken;
  twilioPhoneNumber;
  memoryStoreId;
  memoryApiKey;
  memoryApiToken;
  traitGroups;
  conversationServiceId;
  voicePublicDomain;
  cintelConfigurationId;
  cintelObservationOperatorSid;
  cintelSummaryOperatorSid;
  memoryApiUrl;
  conversationsApiUrl;
  knowledgeApiUrl;
  constructor(data) {
    const validatedConfig = TACConfigSchema.parse(data);
    const serviceUrls = computeServiceUrls(validatedConfig.environment);
    this.environment = validatedConfig.environment;
    this.twilioAccountSid = validatedConfig.twilioAccountSid;
    this.twilioAuthToken = validatedConfig.twilioAuthToken;
    this.twilioPhoneNumber = validatedConfig.twilioPhoneNumber;
    if (validatedConfig.memoryStoreId) {
      this.memoryStoreId = validatedConfig.memoryStoreId;
    }
    if (validatedConfig.memoryApiKey) {
      this.memoryApiKey = validatedConfig.memoryApiKey;
    }
    if (validatedConfig.memoryApiToken) {
      this.memoryApiToken = validatedConfig.memoryApiToken;
    }
    if (validatedConfig.traitGroups) {
      this.traitGroups = validatedConfig.traitGroups;
    }
    this.conversationServiceId = validatedConfig.conversationServiceId;
    if (validatedConfig.voicePublicDomain) {
      this.voicePublicDomain = validatedConfig.voicePublicDomain;
    }
    if (validatedConfig.cintelConfigurationId) {
      this.cintelConfigurationId = validatedConfig.cintelConfigurationId;
    }
    if (validatedConfig.cintelObservationOperatorSid) {
      this.cintelObservationOperatorSid = validatedConfig.cintelObservationOperatorSid;
    }
    if (validatedConfig.cintelSummaryOperatorSid) {
      this.cintelSummaryOperatorSid = validatedConfig.cintelSummaryOperatorSid;
    }
    this.memoryApiUrl = serviceUrls.memoryApiUrl;
    this.conversationsApiUrl = serviceUrls.conversationsApiUrl;
    this.knowledgeApiUrl = serviceUrls.knowledgeApiUrl;
  }
  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
   * - ENVIRONMENT: TAC environment (dev, stage, or prod) - defaults to 'prod'
   * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
   * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
   * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
   * - MEMORY_API_KEY: Memory API Key (optional, required if using Memory)
   * - MEMORY_API_TOKEN: Memory API Token (optional, required if using Memory)
   * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
   * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
   * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
   *
   * @throws Error if required environment variables are not set or invalid
   *
   * @example
   * ```typescript
   * // With all env vars set in .env file
   * const config = TACConfig.fromEnv();
   *
   * // Use in TAC initialization
   * const tac = new TAC({ config });
   * ```
   */
  static fromEnv() {
    (0, import_dotenv.config)();
    const requiredVars = [
      { key: EnvironmentVariables.TWILIO_ACCOUNT_SID, name: "TWILIO_ACCOUNT_SID" },
      { key: EnvironmentVariables.TWILIO_AUTH_TOKEN, name: "TWILIO_AUTH_TOKEN" },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: "TWILIO_PHONE_NUMBER" },
      { key: EnvironmentVariables.CONVERSATION_SERVICE_ID, name: "CONVERSATION_SERVICE_ID" }
    ];
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }
    const rawConfig = {
      environment: process.env[EnvironmentVariables.ENVIRONMENT] ?? "prod",
      twilioAccountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID],
      twilioAuthToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN],
      twilioPhoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER],
      memoryStoreId: process.env[EnvironmentVariables.MEMORY_STORE_ID],
      memoryApiKey: process.env[EnvironmentVariables.MEMORY_API_KEY],
      memoryApiToken: process.env[EnvironmentVariables.MEMORY_API_TOKEN],
      traitGroups: process.env[EnvironmentVariables.TRAIT_GROUPS]?.split(","),
      conversationServiceId: process.env[EnvironmentVariables.CONVERSATION_SERVICE_ID],
      voicePublicDomain: process.env[EnvironmentVariables.VOICE_PUBLIC_DOMAIN],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID]
    };
    return new _TACConfig(rawConfig);
  }
  /**
   * Get basic auth credentials for Twilio APIs
   */
  getBasicAuthCredentials() {
    return {
      username: this.twilioAccountSid,
      password: this.twilioAuthToken
    };
  }
};

// ../core/src/lib/logger.ts
var import_pino = __toESM(require_pino());
function createLogger(options) {
  const level = options?.level || process.env.LOG_LEVEL || "info";
  const isDevelopment = process.env.NODE_ENV !== "production";
  const usePretty = options?.pretty !== void 0 ? options.pretty : isDevelopment;
  const pinoOptions = {
    level,
    ...options?.name && { name: options.name }
  };
  if (usePretty) {
    return (0, import_pino.default)({
      ...pinoOptions,
      transport: {
        target: "pino-pretty",
        options: {}
      }
    });
  }
  return (0, import_pino.default)(pinoOptions);
}

// ../core/src/clients/memory.ts
var MemoryClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config2, logger2) {
    this.baseUrl = config2.memoryApiUrl;
    if (!config2.memoryApiKey || !config2.memoryApiToken) {
      throw new Error(
        "Memory API credentials are required. Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables."
      );
    }
    this.credentials = {
      username: config2.memoryApiKey,
      password: config2.memoryApiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-memory" });
    this.logger = baseLogger.child({ client: "memory" });
  }
  /**
   * Retrieve memories for a specific profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to retrieve memories for
   * @param request - Optional request parameters for filtering results
   * @returns Promise containing memory retrieval response
   */
  async retrieveMemories(serviceSid, profileId, request = {}) {
    try {
      const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Recall`;
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          request
        },
        "Retrieving memories"
      );
      const requestBody = {
        query: request.query,
        start_date: request.start_date,
        end_date: request.end_date,
        observation_limit: request.observation_limit ?? 10,
        summary_limit: request.summary_limit ?? 5,
        session_limit: request.session_limit ?? 3
      };
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== void 0)
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getBasicAuthHeader()
        },
        body: JSON.stringify(cleanedBody)
      };
      this.logRequest(options.method, url, options.body);
      const response = await fetch(url, options);
      await this.logResponse(response);
      if (!response.ok) {
        this.logger.warn(
          {
            http_status: response.status,
            status_text: response.statusText,
            profile_id: profileId,
            memory_store_id: serviceSid
          },
          "Memory retrieval failed"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      const data = await response.json();
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId
        },
        "Raw memory response received"
      );
      const validatedResponse = MemoryRetrievalResponseSchema.safeParse(data);
      if (!validatedResponse.success) {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: serviceSid,
            validation_errors: validatedResponse.error.errors
          },
          "Invalid memory response format"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          observation_count: validatedResponse.data.observations.length,
          summary_count: validatedResponse.data.summaries.length
        },
        "Memory retrieval succeeded"
      );
      return validatedResponse.data;
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          profile_id: profileId,
          memory_store_id: serviceSid
        },
        "Memory retrieval error"
      );
      return EMPTY_MEMORY_RESPONSE;
    }
  }
  /**
   * Find profiles that contain a specific identifier value
   *
   * @param serviceSid - The memory service SID
   * @param idType - Identifier type (e.g., 'phone', 'email')
   * @param value - Raw value captured for the identifier
   * @returns Promise containing profile lookup response with normalized value and matching profile IDs
   */
  async lookupProfile(serviceSid, idType, value) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/Lookup`;
    const requestBody = {
      idType,
      value
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to lookup profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileLookupResponseSchema.parse(data);
  }
  /**
   * Fetch profile information with traits
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to fetch
   * @param traitGroups - Optional list of trait group names to include
   * @returns Promise containing profile response with ID, created timestamp, and traits
   */
  async getProfile(serviceSid, profileId, traitGroups) {
    let url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}`;
    if (traitGroups && traitGroups.length > 0) {
      url += `?traitGroups=${traitGroups.join(",")}`;
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileResponseSchema.parse(data);
  }
  /**
   * Create an observation for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create the observation for
   * @param content - The observation content
   * @param source - Source of the observation (default: 'conversation-intelligence')
   * @param conversationIds - Optional array of conversation IDs associated with this observation
   * @param occurredAt - Optional timestamp when the observation occurred
   * @returns Promise containing the created observation
   */
  async createObservation(serviceSid, profileId, content, source = "conversation-intelligence", conversationIds, occurredAt) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Observations`;
    const requestBody = {
      content,
      source
    };
    if (conversationIds && conversationIds.length > 0) {
      requestBody.conversationIds = conversationIds;
    }
    if (occurredAt) {
      requestBody.occurredAt = occurredAt;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to create observation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return CreateObservationResponseSchema.parse(data);
  }
  /**
   * Create conversation summaries for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create summaries for
   * @param summaries - Array of summary items to create
   * @returns Promise containing a success message for the created conversation summaries
   */
  async createConversationSummaries(serviceSid, profileId, summaries) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/ConversationSummaries`;
    const requestBody = {
      summaries: summaries.map((s) => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? "conversation-intelligence"
      }))
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(
        `Failed to create conversation summaries: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    return CreateConversationSummariesResponseSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Memory HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// ../core/src/clients/conversation.ts
var ConversationClient = class {
  baseUrl;
  credentials;
  conversationServiceId;
  logger;
  constructor(config2, logger2) {
    this.baseUrl = config2.conversationsApiUrl;
    this.credentials = {
      username: config2.twilioAccountSid,
      password: config2.twilioAuthToken
    };
    this.conversationServiceId = config2.conversationServiceId;
    const baseLogger = logger2 || createLogger({ name: "tac-conversations" });
    this.logger = baseLogger.child({ client: "conversations" });
  }
  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  async listCommunications(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Communications`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list communications: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "communications" in data && Array.isArray(data.communications)) {
      return data.communications.map(
        (comm) => CommunicationSchema.parse(comm)
      );
    }
    return [];
  }
  /**
   * Create a new conversation
   *
   * @param name - Optional conversation name
   * @returns Promise containing conversation response
   */
  async createConversation(name) {
    const url = `${this.baseUrl}/v2/Conversations`;
    const requestBody = {
      configurationId: this.conversationServiceId
    };
    if (name) {
      requestBody.name = name;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Add a participant to a conversation
   *
   * @param conversationId - The conversation ID
   * @param addresses - Array of participant addresses
   * @param participantType - Type of participant (CUSTOMER, AI_AGENT, HUMAN_AGENT)
   * @returns Promise containing participant response
   */
  async addParticipant(conversationId, addresses, participantType) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const requestBody = {
      type: participantType,
      addresses
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to add participant: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationParticipantSchema.parse(data);
  }
  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  async listParticipants(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list participants: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "participants" in data && Array.isArray(data.participants)) {
      return data.participants.map(
        (participant) => ConversationParticipantSchema.parse(participant)
      );
    }
    return [];
  }
  /**
   * List conversations with optional filters
   *
   * @param filters - Optional filters (channelId, status)
   * @returns Promise containing array of conversations
   */
  async listConversations(filters) {
    const urlObj = new URL(`${this.baseUrl}/v2/Conversations`);
    if (filters?.channelId) {
      urlObj.searchParams.set("channelId", filters.channelId);
    }
    if (filters?.status && filters.status.length > 0) {
      urlObj.searchParams.set("status", filters.status.join(","));
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, urlObj.toString());
    const response = await fetch(urlObj.toString(), options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list conversations: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "conversations" in data && Array.isArray(data.conversations)) {
      return data.conversations.map(
        (c) => ConversationResponseSchema.parse(c)
      );
    }
    return [];
  }
  /**
   * Update conversation status
   *
   * @param conversationId - The conversation ID
   * @param status - New status (ACTIVE, INACTIVE, CLOSED)
   * @returns Promise containing updated conversation
   */
  async updateConversation(conversationId, status) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}`;
    const requestBody = { status };
    const options = {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to update conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Conversations Service HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// ../core/src/clients/knowledge.ts
var KnowledgeClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config2, logger2) {
    this.baseUrl = config2.knowledgeApiUrl;
    if (!config2.memoryApiKey || !config2.memoryApiToken) {
      throw new Error(
        "Memory API credentials are required for Knowledge client. Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables."
      );
    }
    this.credentials = {
      username: config2.memoryApiKey,
      password: config2.memoryApiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-knowledge" });
    this.logger = baseLogger.child({ client: "knowledge" });
  }
  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  async getKnowledgeBase(knowledgeBaseId) {
    const url = `${this.baseUrl}/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return KnowledgeBaseSchema.parse(data);
  }
  /**
   * Search knowledge base for relevant content
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @param query - Search query (max 2048 characters)
   * @param topK - Maximum number of results to return (default: 5, max: 20)
   * @param knowledgeIds - Optional list of knowledge IDs to filter results
   * @returns Promise containing array of search result chunks
   */
  async searchKnowledgeBase(knowledgeBaseId, query, topK = 5, knowledgeIds) {
    const url = `${this.baseUrl}/v2/KnowledgeBases/${knowledgeBaseId}/Search`;
    const requestBody = {
      query,
      top: Math.min(Math.max(topK, 1), 20)
      // Clamp to 1-20
    };
    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to search knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const validated = KnowledgeSearchResponseSchema.parse(data);
    return validated.chunks;
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Knowledge HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// ../core/src/lib/operator-result-processor.ts
function extractProfileIds(operatorResult) {
  const profileIds = [];
  if (operatorResult.executionDetails?.participants) {
    for (const participant of operatorResult.executionDetails.participants) {
      if (participant.profileId) {
        profileIds.push(participant.profileId);
      }
    }
  }
  return profileIds;
}
function generateContent(operatorResult) {
  const result = operatorResult.result;
  if (result === null || result === void 0) {
    return void 0;
  }
  if (typeof result === "string") {
    return result.trim() || void 0;
  }
  const jsonString = JSON.stringify(result);
  return jsonString === "{}" || jsonString === "[]" ? void 0 : jsonString;
}
function parseObservationsContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "observations" in parsed) {
      const observations = parsed.observations;
      if (Array.isArray(observations)) {
        return observations.filter(
          (obs) => typeof obs === "string" && obs.trim() !== ""
        );
      }
    }
    return [];
  } catch {
    return [];
  }
}
function parseSummariesContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "summaries" in parsed) {
      const summaries = parsed.summaries;
      if (Array.isArray(summaries)) {
        return summaries.filter((s) => typeof s === "string" && s.trim() !== "");
      }
    }
    return [];
  } catch {
    return [];
  }
}
var OperatorResultProcessor = class {
  memoryClient;
  config;
  logger;
  constructor(memoryClient, config2, logger2) {
    this.memoryClient = memoryClient;
    this.config = config2;
    this.logger = logger2 ?? createLogger({ name: "cintel-processor" });
  }
  /**
   * Process an operator result event webhook payload
   *
   * @param payload - The raw webhook payload
   * @returns Processing result indicating success/failure and details
   */
  async processEvent(payload) {
    const parseResult = OperatorResultEventSchema.safeParse(payload);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors },
        "Invalid operator result event payload"
      );
      return {
        success: false,
        skipped: false,
        error: `Invalid payload: ${parseResult.error.message}`,
        createdCount: 0
      };
    }
    const event = parseResult.data;
    if (event.intelligenceConfiguration.id !== this.config.configurationId) {
      this.logger.debug(
        {
          received_config_id: event.intelligenceConfiguration.id,
          expected_config_id: this.config.configurationId
        },
        "Skipping event from different CI configuration"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Event from different CI configuration: ${event.intelligenceConfiguration.id}`,
        createdCount: 0
      };
    }
    const results = [];
    for (const operatorResult of event.operatorResults) {
      const result = await this.processOperatorResult(event, operatorResult);
      results.push(result);
    }
    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const errorCount = results.filter((r) => !r.success).length;
    const totalCreated = results.reduce((sum, r) => sum + r.createdCount, 0);
    const eventTypes = results.filter((r) => r.success && !r.skipped && r.eventType).map((r) => r.eventType);
    const uniqueEventTypes = [...new Set(eventTypes)];
    const eventType = uniqueEventTypes.length === 1 ? uniqueEventTypes[0] : uniqueEventTypes.length > 1 ? "mixed" : void 0;
    if (errorCount > 0) {
      const errors = results.filter((r) => !r.success).map((r) => r.error);
      return {
        success: false,
        eventType,
        skipped: false,
        error: `${errorCount} operator(s) failed: ${errors.join("; ")}`,
        createdCount: totalCreated
      };
    }
    if (skippedCount === results.length) {
      return {
        success: true,
        skipped: true,
        skipReason: "All operator results were skipped",
        createdCount: 0
      };
    }
    this.logger.info(
      {
        conversation_id: event.conversationId,
        success_count: successCount,
        skipped_count: skippedCount,
        created_count: totalCreated,
        event_type: eventType
      },
      "Processed operator result event"
    );
    return {
      success: true,
      eventType,
      skipped: false,
      createdCount: totalCreated
    };
  }
  /**
   * Process an individual operator result
   */
  async processOperatorResult(event, operatorResult) {
    const operatorSid = operatorResult.operator.id;
    const isObservationOperator = this.config.observationOperatorSid === operatorSid;
    const isSummaryOperator = this.config.summaryOperatorSid === operatorSid;
    if (!isObservationOperator && !isSummaryOperator) {
      this.logger.debug(
        {
          operator_sid: operatorSid,
          observation_operator_sid: this.config.observationOperatorSid,
          summary_operator_sid: this.config.summaryOperatorSid
        },
        "Skipping unconfigured operator"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Operator ${operatorSid} is not configured for processing`,
        createdCount: 0
      };
    }
    const content = generateContent(operatorResult);
    if (!content) {
      this.logger.debug(
        { operator_sid: operatorSid },
        "Skipping operator result with empty content"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "Operator result has empty content",
        createdCount: 0
      };
    }
    const profileIds = extractProfileIds(operatorResult);
    if (profileIds.length === 0) {
      this.logger.warn(
        { operator_sid: operatorSid, conversation_id: event.conversationId },
        "No profile IDs found in operator result"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "No profile IDs found in operator result execution details",
        createdCount: 0
      };
    }
    if (!event.memoryStoreId) {
      this.logger.warn({ conversation_id: event.conversationId }, "No memory store ID in event");
      return {
        success: false,
        skipped: false,
        error: "No memory store ID provided in event",
        createdCount: 0
      };
    }
    if (isObservationOperator) {
      return this.processObservationEvent(event, operatorResult, content, profileIds);
    } else {
      return this.processSummaryEvent(event, operatorResult, content, profileIds);
    }
  }
  /**
   * Process an observation operator result
   */
  async processObservationEvent(event, operatorResult, content, profileIds) {
    const observations = parseObservationsContent(content);
    if (observations.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No observations found in content"
      );
      return {
        success: true,
        eventType: "observation",
        skipped: true,
        skipReason: "No observations found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      for (const observation of observations) {
        try {
          await this.memoryClient.createObservation(
            event.memoryStoreId,
            profileId,
            observation,
            "conversation-intelligence",
            [event.conversationId],
            operatorResult.dateCreated
          );
          createdCount++;
          this.logger.debug(
            {
              profile_id: profileId,
              conversation_id: event.conversationId,
              observation_preview: observation.substring(0, 100)
            },
            "Created observation"
          );
        } catch (error) {
          this.logger.error(
            {
              err: error,
              profile_id: profileId,
              conversation_id: event.conversationId
            },
            "Failed to create observation"
          );
          return {
            success: false,
            eventType: "observation",
            skipped: false,
            error: `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
            createdCount
          };
        }
      }
    }
    return {
      success: true,
      eventType: "observation",
      skipped: false,
      createdCount
    };
  }
  /**
   * Process a summary operator result
   */
  async processSummaryEvent(event, operatorResult, content, profileIds) {
    const summaries = parseSummariesContent(content);
    if (summaries.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No summaries found in content"
      );
      return {
        success: true,
        eventType: "summary",
        skipped: true,
        skipReason: "No summaries found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      try {
        const summaryItems = summaries.map((summaryContent) => ({
          content: summaryContent,
          conversationId: event.conversationId,
          occurredAt: operatorResult.dateCreated,
          source: "conversation-intelligence"
        }));
        await this.memoryClient.createConversationSummaries(
          event.memoryStoreId,
          profileId,
          summaryItems
        );
        createdCount += summaries.length;
        this.logger.debug(
          {
            profile_id: profileId,
            conversation_id: event.conversationId,
            summary_count: summaries.length
          },
          "Created conversation summaries"
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            profile_id: profileId,
            conversation_id: event.conversationId
          },
          "Failed to create conversation summaries"
        );
        return {
          success: false,
          eventType: "summary",
          skipped: false,
          error: `Failed to create summaries: ${error instanceof Error ? error.message : String(error)}`,
          createdCount
        };
      }
    }
    return {
      success: true,
      eventType: "summary",
      skipped: false,
      createdCount
    };
  }
};

// ../core/src/lib/tac.ts
var TAC = class {
  config;
  logger;
  memoryClient;
  knowledgeClient;
  conversationClient;
  channels;
  cintelProcessor;
  // Callback registrations
  messageReadyCallback;
  interruptCallback;
  handoffCallback;
  conversationEndedCallback;
  constructor(options = {}) {
    const finalConfig = options.config ? options.config instanceof TACConfig ? options.config : new TACConfig(options.config) : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: "tac" });
    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = /* @__PURE__ */ new Map();
    if (this.config.memoryStoreId && this.config.memoryApiKey && this.config.memoryApiToken) {
      this.memoryClient = new MemoryClient(this.config, this.logger.child({ component: "memory" }));
      this.logger.info("Memory client initialized");
      this.knowledgeClient = new KnowledgeClient(
        this.config,
        this.logger.child({ component: "knowledge" })
      );
      this.logger.info("Knowledge client initialized");
    } else {
      this.logger.info("Memory and Knowledge clients not initialized (credentials not provided)");
    }
    if (this.memoryClient && this.config.cintelConfigurationId) {
      this.cintelProcessor = new OperatorResultProcessor(
        this.memoryClient,
        {
          configurationId: this.config.cintelConfigurationId,
          observationOperatorSid: this.config.cintelObservationOperatorSid,
          summaryOperatorSid: this.config.cintelSummaryOperatorSid
        },
        this.logger.child({ component: "cintel" })
      );
      this.logger.info("Conversation Intelligence processor initialized");
    }
    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: "conversation" })
    );
  }
  /**
   * Register a channel with the framework
   */
  registerChannel(channel) {
    this.logger.info({ channel: channel.channelType }, "Registering channel");
    const existingChannel = this.channels.get(channel.channelType);
    if (existingChannel) {
      this.logger.info({ channel: channel.channelType }, "Replacing existing channel registration");
      existingChannel.shutdown();
    }
    this.channels.set(channel.channelType, channel);
    this.setupChannelEventListeners(channel);
    this.logger.info({ channel: channel.channelType }, "Channel registration complete");
  }
  /**
   * Set up event listeners for a channel
   */
  setupChannelEventListeners(channel) {
    channel.on(
      "error",
      ({ error, context }) => {
        this.logger.error({ err: error, ...context }, "Channel error");
      }
    );
    channel.on(
      "messageReceived",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async (data) => {
        await this.handleMessageReady({ ...data, channelType: channel.channelType });
      }
    );
    channel.on(
      "prompt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async ({
        conversationId,
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session) {
          await this.handleMessageReady({
            conversationId,
            profileId: session.profile_id ? session.profile_id : void 0,
            message: transcript,
            author: "user",
            // Voice transcripts are always from user
            userMemory: void 0,
            channelType: channel.channelType
          });
        }
      }
    );
    channel.on(
      "interrupt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({
        conversationId,
        reason,
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session && this.interruptCallback) {
          try {
            await this.interruptCallback({
              conversationId,
              reason,
              transcript: transcript ?? void 0,
              session
            });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: conversationId },
              "Interrupt callback error"
            );
          }
        }
      }
    );
    channel.on(
      "conversationEnded",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({ session }) => {
        if (this.conversationEndedCallback) {
          try {
            await this.conversationEndedCallback({ session });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: session.conversation_id },
              "Conversation ended callback error"
            );
          }
        }
      }
    );
  }
  /**
   * Handle message ready event from channels
   */
  async handleMessageReady(data) {
    this.logger.debug(
      {
        conversation_id: data.conversationId,
        profile_id: data.profileId,
        author: data.author,
        message_length: data.message.length,
        channel: data.channelType,
        operation: "handle_message_ready"
      },
      "Handling message ready"
    );
    if (!this.messageReadyCallback) {
      this.logger.warn("No message ready callback registered");
      return;
    }
    try {
      const channel = this.channels.get(data.channelType);
      if (!channel) {
        throw new Error(`No channel found for type ${data.channelType}`);
      }
      this.logger.debug(
        { conversation_id: data.conversationId, channel: channel.channelType },
        "Using channel for message"
      );
      const session = channel.getConversationSession(data.conversationId);
      if (!session) {
        throw new Error(`No session found for conversation ${data.conversationId}`);
      }
      let memory = data.userMemory;
      if (!memory && data.profileId && this.memoryClient && this.config.memoryStoreId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: "memory_retrieval" },
          "Retrieving memory for profile"
        );
        try {
          const memoryResponse = await this.memoryClient.retrieveMemories(
            this.config.memoryStoreId,
            data.profileId
          );
          memory = new TACMemoryResponse(memoryResponse);
          this.logger.debug({ profile_id: data.profileId }, "Memory retrieved");
        } catch (error) {
          this.logger.warn({ err: error, profile_id: data.profileId }, "Failed to retrieve memory");
        }
      }
      this.logger.debug(
        { conversation_id: data.conversationId },
        "Executing message ready callback"
      );
      try {
        await this.messageReadyCallback({
          conversationId: data.conversationId,
          profileId: data.profileId,
          message: data.message,
          author: data.author,
          memory: memory ?? void 0,
          session,
          channel: channel.channelType
        });
        this.logger.debug(
          { conversation_id: data.conversationId },
          "Message ready callback completed"
        );
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: data.conversationId },
          "Message ready callback error"
        );
      }
      this.logger.debug({ conversation_id: data.conversationId }, "Message handling completed");
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: data.conversationId },
        "Message handling error"
      );
    }
  }
  /**
   * Register callback for when messages are ready to be processed
   */
  onMessageReady(callback) {
    this.messageReadyCallback = callback;
  }
  /**
   * Register callback for when user interrupts (voice channel)
   */
  onInterrupt(callback) {
    this.interruptCallback = callback;
  }
  /**
   * Register callback for human handoff
   */
  onHandoff(callback) {
    this.handoffCallback = callback;
  }
  /**
   * Register callback for when a conversation ends.
   *
   * The callback is triggered by channels when a conversation is closed
   * (e.g., SMS conversation status changed to CLOSED, or voice WebSocket
   * disconnected). The callback receives the full ConversationSession before
   * it is cleaned up.
   */
  onConversationEnded(callback) {
    this.conversationEndedCallback = callback;
  }
  /**
   * Trigger handoff callback
   */
  async triggerHandoff(conversationId, reason) {
    if (!this.handoffCallback) {
      this.logger.warn({ conversation_id: conversationId }, "No handoff callback registered");
      return;
    }
    const channel = this.getChannelByConversationId(conversationId);
    const session = channel?.getConversationSession(conversationId);
    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }
    try {
      await this.handoffCallback({
        conversationId,
        profileId: session.profile_id ? session.profile_id : void 0,
        reason,
        session
      });
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Handoff callback error");
    }
  }
  /**
   * Get channel by conversation ID
   */
  getChannelByConversationId(conversationId) {
    for (const channel of this.channels.values()) {
      if (channel.isConversationActive(conversationId)) {
        return channel;
      }
    }
    return void 0;
  }
  /**
   * Get registered channel by type
   */
  getChannel(channelType) {
    return this.channels.get(channelType);
  }
  /**
   * Get configuration
   */
  getConfig() {
    return this.config;
  }
  /**
   * Get memory client for advanced memory operations
   * Returns undefined if memory credentials are not configured
   */
  getMemoryClient() {
    return this.memoryClient;
  }
  /**
   * Get knowledge client for knowledge base operations
   * Returns undefined if memory credentials are not configured
   */
  getKnowledgeClient() {
    return this.knowledgeClient;
  }
  /**
   * Get conversation client for advanced conversation operations
   */
  getConversationClient() {
    return this.conversationClient;
  }
  /**
   * Check if Twilio Memory functionality is enabled
   *
   * @returns true if memory client is initialized, false otherwise
   */
  isMemoryEnabled() {
    return this.memoryClient !== void 0;
  }
  /**
   * Check if Knowledge functionality is enabled
   *
   * @returns true if knowledge client is initialized, false otherwise
   */
  isKnowledgeEnabled() {
    return this.knowledgeClient !== void 0;
  }
  /**
   * Check if Conversation Intelligence processing is enabled
   *
   * @returns true if CI processor is initialized, false otherwise
   */
  isCintelEnabled() {
    return this.cintelProcessor !== void 0;
  }
  /**
   * Process a Conversation Intelligence operator result webhook event
   *
   * @param payload - The raw webhook payload from CI
   * @returns Promise containing the processing result
   * @throws Error if CI processor is not initialized
   */
  async processCintelEvent(payload) {
    if (!this.cintelProcessor) {
      throw new Error(
        "Conversation Intelligence processor is not initialized. Ensure both memory credentials and cintelConfigurationId are provided."
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }
  /**
   * Retrieve memories from Memory API or fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
   *
   * When Memory is configured:
   * - observations, summaries, and communications available
   * - communications include author name and type
   *
   * When using Maestro fallback:
   * - observations and summaries are empty arrays
   * - communications have basic fields only (no author name/type)
   */
  async retrieveMemory(session, query) {
    if (this.memoryClient && this.config.memoryStoreId) {
      if (!session.profile_id) {
        this.logger.debug("profile_id not found, attempting to lookup profile using phone number");
        if (!session.author_info || !session.author_info.address) {
          throw new Error(
            "profile_id is required for memory retrieval but was not found in conversation context. Additionally, author_info.address is not available for profile lookup. Ensure either profile_id or author_info.address is provided when creating the ConversationSession."
          );
        }
        try {
          const lookupResponse = await this.memoryClient.lookupProfile(
            this.config.memoryStoreId,
            "phone",
            session.author_info.address
          );
          if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
            throw new Error(
              `No profile found for phone number ${session.author_info.address}. Profile lookup returned no results. Ensure the phone number is registered in the identity resolution system.`
            );
          }
          session.profile_id = lookupResponse.profiles[0];
        } catch (error) {
          this.logger.error(
            { err: error },
            `Failed to lookup profile for ${session.author_info.address}`
          );
          throw error;
        }
      }
      try {
        const memoryResponse = await this.memoryClient.retrieveMemories(
          this.config.memoryStoreId,
          session.profile_id,
          { query }
        );
        return new TACMemoryResponse(memoryResponse);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve memory");
        throw error;
      }
    } else {
      this.logger.info("Twilio Memory not configured, falling back to Conversations API");
      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversation_id
        );
        return new TACMemoryResponse(communications);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve communications");
        throw error;
      }
    }
  }
  /**
   * Fetch profile information with traits
   *
   * @param profileId - Profile ID to fetch
   * @returns Promise containing profile response or undefined if not available
   */
  async fetchProfile(profileId) {
    if (!this.memoryClient || !this.config.memoryStoreId) {
      this.logger.warn(
        "Memory client is not initialized. Cannot fetch profile. Provide memory credentials when creating TAC to enable profile fetching."
      );
      return void 0;
    }
    if (!profileId) {
      this.logger.warn("profile_id is required for profile fetching but was not provided");
      return void 0;
    }
    try {
      const traitGroups = this.config.traitGroups;
      const profileResponse = await this.memoryClient.getProfile(
        this.config.memoryStoreId,
        profileId,
        traitGroups
      );
      return profileResponse;
    } catch (error) {
      this.logger.error({ err: error }, `Failed to fetch profile for ${profileId}`);
      return void 0;
    }
  }
  /**
   * Shutdown TAC and cleanup resources
   */
  shutdown() {
    for (const channel of this.channels.values()) {
      this.logger.debug({ channel: channel.channelType }, "Shutting down channel");
      channel.shutdown();
    }
    this.channels.clear();
    this.logger.info("TAC shutdown complete");
  }
};

// ../core/src/channels/base.ts
var BaseChannel = class {
  tac;
  config;
  logger;
  conversationClient;
  activeConversations;
  callbacks;
  constructor(tac) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: "channel" });
    this.conversationClient = new ConversationClient(this.config);
    this.activeConversations = /* @__PURE__ */ new Map();
    this.callbacks = {};
  }
  /**
   * Register event callbacks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "conversationStarted":
        this.callbacks.onConversationStarted = callback;
        break;
      case "conversationEnded":
        this.callbacks.onConversationEnded = callback;
        break;
      case "error":
        this.callbacks.onError = callback;
        break;
    }
  }
  /**
   * Start a new conversation session
   */
  startConversation(conversationId, profileId, serviceId) {
    if (this.activeConversations.has(conversationId)) {
      this.logger.debug(
        {
          conversation_id: conversationId,
          profile_id: this.activeConversations.get(conversationId)?.profile_id,
          service_id: this.activeConversations.get(conversationId)?.service_id
        },
        "Conversation already active"
      );
      return this.activeConversations.get(conversationId);
    }
    const session = {
      conversation_id: conversationId,
      profile_id: profileId,
      service_id: serviceId,
      channel: this.channelType,
      started_at: /* @__PURE__ */ new Date(),
      metadata: {}
    };
    this.activeConversations.set(conversationId, session);
    this.logger.debug(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        service_id: serviceId,
        channel: this.channelType
      },
      "Conversation started"
    );
    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }
    return session;
  }
  /**
   * End a conversation session.
   *
   * Triggers the onConversationEnded callback BEFORE removing the session,
   * so the callback receives the full ConversationSession data.
   * Errors in the callback do not prevent session cleanup.
   */
  async endConversation(conversationId) {
    const session = this.activeConversations.get(conversationId);
    if (session) {
      if (this.callbacks.onConversationEnded) {
        try {
          await this.callbacks.onConversationEnded({ session });
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversationId },
            "Error in conversation ended callback"
          );
        }
      }
      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.service_id
        },
        "Conversation ended"
      );
    } else {
      this.logger.debug(
        { conversation_id: conversationId, channel: this.channelType },
        "Conversation end requested but no active session found"
      );
    }
  }
  /**
   * Get an active conversation session
   */
  getConversationSession(conversationId) {
    return this.activeConversations.get(conversationId);
  }
  /**
   * Check if a conversation is active
   */
  isConversationActive(conversationId) {
    return this.activeConversations.has(conversationId);
  }
  /**
   * Handle errors with proper context
   */
  handleError(error, context) {
    this.logger.error({ err: error, ...context }, "Channel error");
    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }
  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  validateWebhookPayload(payload) {
    return payload !== null && payload !== void 0;
  }
  /**
   * Cleanup resources when shutting down
   */
  shutdown() {
    this.activeConversations.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
};
var SMSChannel = class extends BaseChannel {
  twilioClient;
  smsCallbacks;
  constructor(tac) {
    super(tac);
    this.twilioClient = twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
    this.smsCallbacks = {};
  }
  get channelType() {
    return "sms";
  }
  /**
   * Register event callbacks (override for SMS-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    if (event === "messageReceived") {
      this.smsCallbacks.onMessageReceived = callback;
    } else {
      super.on(event, callback);
    }
  }
  /**
   * Process SMS webhook from Twilio Conversations Service
   */
  async processWebhook(payload) {
    this.logger.debug({ operation: "webhook_processing", payload }, "Processing webhook");
    try {
      if (!this.validateWebhookPayload(payload)) {
        throw new Error("Invalid webhook payload");
      }
      const webhookData = payload;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data?.conversationId || webhookData.data?.id;
      this.logger.info(
        {
          event_type: eventType,
          raw_event_type: webhookData.eventType,
          conversation_id: conversationId
        },
        "Processing webhook event"
      );
      switch (eventType) {
        case "CONVERSATION_CREATED":
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            "Handling CONVERSATION_CREATED"
          );
          this.handleConversationCreated(webhookData);
          break;
        case "PARTICIPANT_ADDED":
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            "Handling PARTICIPANT_ADDED"
          );
          this.handleParticipantAdded(webhookData);
          break;
        case "COMMUNICATION_CREATED":
          this.logger.debug({ conversation_id: conversationId }, "Handling COMMUNICATION_CREATED");
          await this.handleCommunicationCreated(webhookData);
          break;
        case "CONVERSATION_UPDATED":
          this.logger.debug(
            { conversation_id: conversationId, status: webhookData.data?.status },
            "Handling CONVERSATION_UPDATED"
          );
          await this.handleConversationUpdated(webhookData);
          break;
        default:
          this.logger.warn(
            {
              event_type: eventType,
              raw_event_type: webhookData.eventType,
              conversation_id: conversationId,
              payload
            },
            "Unhandled event type - this event will be ignored"
          );
      }
      this.logger.debug({ event_type: eventType }, "Webhook processing completed");
    } catch (error) {
      this.logger.error(
        { err: error, operation: "webhook_processing" },
        "Webhook processing error"
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }
  /**
   * Handle conversation creation event
   */
  handleConversationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_conversation_created" },
        "Missing conversation ID in conversation.created event"
      );
      throw new Error("Missing conversation ID in conversation.created event");
    }
    this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
  }
  /**
   * Handle participant added event
   */
  handleParticipantAdded(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_participant_added" },
        "Missing conversation ID in participant.added event"
      );
      throw new Error("Missing conversation ID in participant.added event");
    }
    if (this.isConversationActive(conversationId)) {
      if (profileId) {
        const session = this.getConversationSession(conversationId);
        if (session) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_profile_id: session.profile_id,
              new_profile_id: profileId
            },
            "Updating conversation profile ID from participant.added"
          );
          session.profile_id = profileId;
        }
      }
      if (payload.data?.serviceId) {
        const session = this.getConversationSession(conversationId);
        if (session && session.service_id !== payload.data.serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.service_id,
              new_service_id: payload.data.serviceId
            },
            "Updating conversation configuration ID from participant.added"
          );
          session.service_id = payload.data.serviceId;
        }
      }
    } else {
      this.logger.debug(
        { conversation_id: conversationId, profile_id: profileId },
        "Auto-starting conversation from participant.added"
      );
      this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
    }
  }
  /**
   * Handle new communication event (incoming message)
   */
  async handleCommunicationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    const message = payload.data?.content?.text?.trim();
    const author = payload.data?.author?.address || "unknown";
    this.logger.info(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        author,
        message,
        message_length: message?.length,
        operation: "handle_communication_created"
      },
      "Handling communication.created"
    );
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_communication_created" },
        "Missing conversation ID in communication.created event"
      );
      throw new Error("Missing conversation ID in communication.created event");
    }
    if (!message) {
      this.logger.info({ conversation_id: conversationId }, "Ignoring empty message");
      return;
    }
    if (author === this.config.twilioPhoneNumber) {
      this.logger.info(
        {
          conversation_id: conversationId,
          author_address: author
        },
        "Ignoring message from AI agent"
      );
      return;
    }
    if (!this.isConversationActive(conversationId)) {
      this.logger.debug({ conversation_id: conversationId }, "Starting new conversation");
      this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
    } else if (payload.data?.serviceId) {
      const session2 = this.getConversationSession(conversationId);
      if (session2 && session2.service_id !== payload.data.serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session2.service_id,
            new_service_id: payload.data.serviceId
          },
          "Updating conversation configuration ID from communication.created"
        );
        session2.service_id = payload.data.serviceId;
      }
    }
    const session = this.getConversationSession(conversationId);
    if (session) {
      session.author_info = {
        address: author,
        participant_id: payload.data?.author?.participantId
      };
    }
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      this.logger.debug({ conversation_id: conversationId, author }, "Retrieving user memory");
      try {
        userMemory = await this.tac.retrieveMemory(session, message);
        this.logger.debug(
          { conversation_id: conversationId, profile_id: session.profile_id },
          "User memory retrieved"
        );
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          "Failed to retrieve user memory"
        );
      }
    }
    if (this.smsCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, "Invoking message received callback");
      this.smsCallbacks.onMessageReceived({
        conversationId,
        profileId: profileId ?? void 0,
        message,
        author,
        userMemory
      });
    }
  }
  /**
   * Handle conversation updated event
   */
  async handleConversationUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in conversation.updated event");
    }
    if (payload.data?.status === "CLOSED") {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        "Conversation closed, cleaning up"
      );
      await this.endConversation(conversationId);
    }
  }
  /**
   * Send SMS response using Twilio Messages API
   * Note: This is a workaround until Conversations Service supports sending messages
   */
  async sendResponse(conversationId, message, metadata) {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: "send_response"
      },
      "Sending SMS response"
    );
    try {
      const session = this.getConversationSession(conversationId);
      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }
      try {
        this.logger.debug(
          { conversation_id: conversationId },
          "Listing participants for conversation"
        );
        const participants = await this.conversationClient.listParticipants(conversationId);
        this.logger.debug(
          {
            conversation_id: conversationId,
            participant_count: participants.length,
            service_id: session.service_id ?? this.config.conversationServiceId
          },
          "Found participants"
        );
        let messagesSent = 0;
        for (const participant of participants) {
          if (participant.type !== "CUSTOMER") {
            this.logger.debug(
              { participant_type: participant.type },
              "Skipping non-customer participant"
            );
            continue;
          }
          const addresses = participant.addresses || [];
          this.logger.debug(
            { addresses_count: addresses.length },
            "Checking participant addresses"
          );
          for (const addr of addresses) {
            if (addr.channel !== "SMS") {
              this.logger.debug({ channel: addr.channel }, "Skipping non-SMS address");
              continue;
            }
            this.logger.debug(
              { to_address: addr.address, from_number: this.config.twilioPhoneNumber },
              "Sending SMS"
            );
            await this.twilioClient.messages.create({
              to: addr.address,
              from: this.config.twilioPhoneNumber,
              body: message
            });
            this.logger.info(
              { conversation_id: conversationId, to_address: addr.address },
              "SMS sent successfully"
            );
            messagesSent++;
          }
        }
        if (messagesSent === 0) {
          this.logger.warn(
            { conversation_id: conversationId },
            "No SMS addresses found for any CUSTOMER participants"
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          "Failed to list participants"
        );
        throw error;
      }
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Send response error");
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata
      });
      throw error;
    }
  }
  /**
   * Extract conversation ID from webhook payload
   */
  extractConversationId(payload) {
    const webhookData = payload;
    const conversationId = webhookData.data?.conversationId || webhookData.data?.id;
    if (conversationId && isConversationId(conversationId)) {
      return conversationId;
    }
    return null;
  }
  /**
   * Extract profile ID from webhook payload
   */
  extractProfileId(payload) {
    const webhookData = payload;
    const profileId = webhookData.data?.profileId;
    if (profileId && isProfileId(profileId)) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: webhookData.data?.conversationId },
        "Extracted profile ID from webhook payload"
      );
      return profileId;
    }
    this.logger.debug(
      { conversation_id: webhookData.data?.conversationId },
      "Profile ID missing or invalid in webhook payload"
    );
    return null;
  }
  /**
   * Validate SMS webhook payload structure
   */
  validateWebhookPayload(payload) {
    if (!super.validateWebhookPayload(payload)) {
      return false;
    }
    const webhookData = payload;
    return typeof webhookData === "object" && typeof webhookData.eventType === "string" && webhookData.eventType.length > 0;
  }
};
var VoiceChannel = class extends BaseChannel {
  webSocketConnections;
  callSidToConversationId;
  voiceCallbacks;
  streamTasks;
  constructor(tac) {
    super(tac);
    this.webSocketConnections = /* @__PURE__ */ new Map();
    this.callSidToConversationId = /* @__PURE__ */ new Map();
    this.voiceCallbacks = {};
    this.streamTasks = /* @__PURE__ */ new Map();
  }
  get channelType() {
    return "voice";
  }
  /**
   * Register event callbacks (override for Voice-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "setup":
        this.voiceCallbacks.onSetup = callback;
        break;
      case "prompt":
        this.voiceCallbacks.onPrompt = callback;
        break;
      case "interrupt":
        this.voiceCallbacks.onInterrupt = callback;
        break;
      case "webSocketConnected":
        this.voiceCallbacks.onWebSocketConnected = callback;
        break;
      case "webSocketDisconnected":
        this.voiceCallbacks.onWebSocketDisconnected = callback;
        break;
      default:
        super.on(event, callback);
        break;
    }
  }
  /**
   * Process webhook - Voice channel doesn't use traditional webhooks,
   * but this method is required by the base class
   */
  processWebhook(_payload) {
    this.logger.warn("processWebhook called but Voice channel uses WebSocket connections");
    return Promise.resolve();
  }
  /**
   * Get active WebSocket connection for a conversation
   */
  getWebsocket(conversationId) {
    return this.webSocketConnections.get(conversationId) || null;
  }
  /**
   * Handle WebSocket connection from ConversationRelay
   */
  handleWebSocketConnection(ws) {
    let conversationId = null;
    ws.on("message", (data) => {
      try {
        const messageText = data.toString();
        const messageData = JSON.parse(messageText);
        this.logger.debug({ raw_message: messageData }, "Received WebSocket message");
        const validatedMessage = WebSocketMessageSchema.safeParse(messageData);
        if (!validatedMessage.success) {
          this.logger.error(
            { validation_errors: validatedMessage.error.errors, raw_message: messageData },
            "Invalid WebSocket message"
          );
          return;
        }
        const message = validatedMessage.data;
        switch (message.type) {
          case "setup":
            conversationId = this.handleSetupMessage(ws, message);
            break;
          case "prompt":
            if (conversationId) {
              this.handlePromptMessage(conversationId, message);
            }
            break;
          case "interrupt":
            if (conversationId) {
              this.handleInterruptMessage(conversationId, message);
            }
            break;
          default:
            this.logger.warn(
              { conversation_id: conversationId, message: messageData },
              "Unhandled WebSocket event type"
            );
            break;
        }
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(String(error)), {
          conversationId,
          message: data.toString()
        });
      }
    });
    ws.on("close", () => {
      if (conversationId) {
        void this.handleWebSocketDisconnect(conversationId).catch((err) => {
          this.logger.error(
            { err, conversation_id: conversationId },
            "WebSocket disconnect handler error"
          );
        });
      }
    });
    ws.on("error", (error) => {
      this.handleError(error, { conversationId });
    });
  }
  /**
   * Handle WebSocket setup message
   */
  handleSetupMessage(ws, message) {
    const { callSid, from, to, customParameters } = message;
    let conversationId;
    let profileId;
    if (customParameters?.conversation_id && typeof customParameters.conversation_id === "string" && isConversationId(customParameters.conversation_id)) {
      conversationId = customParameters.conversation_id;
    } else {
      conversationId = callSid;
    }
    if (customParameters?.profile_id && typeof customParameters.profile_id === "string" && isProfileId(customParameters.profile_id)) {
      profileId = customParameters.profile_id;
    }
    this.webSocketConnections.set(conversationId, ws);
    this.callSidToConversationId.set(callSid, conversationId);
    const session = this.startConversation(conversationId, profileId);
    session.author_info = {
      address: from
    };
    if (this.voiceCallbacks.onSetup) {
      this.voiceCallbacks.onSetup({
        conversationId,
        profileId: profileId ?? void 0,
        callSid,
        from,
        to,
        customParameters: customParameters ?? void 0
      });
    }
    if (this.voiceCallbacks.onWebSocketConnected) {
      this.voiceCallbacks.onWebSocketConnected({ conversationId });
    }
    return conversationId;
  }
  /**
   * Handle WebSocket prompt message (user speech)
   */
  handlePromptMessage(conversationId, message) {
    const transcript = message.voicePrompt;
    this.cancelStreamTask(conversationId);
    if (this.voiceCallbacks.onPrompt) {
      this.voiceCallbacks.onPrompt({
        conversationId,
        transcript
      });
    }
  }
  /**
   * Handle WebSocket interrupt message
   */
  handleInterruptMessage(conversationId, message) {
    const { reason, transcript } = message;
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        "Cancelled stream task due to interrupt"
      );
    }
    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        reason: reason ?? "unknown",
        transcript: transcript ?? void 0
      });
    }
  }
  /**
   * Handle WebSocket disconnection
   */
  async handleWebSocketDisconnect(conversationId) {
    this.webSocketConnections.delete(conversationId);
    for (const [callSid, cId] of this.callSidToConversationId.entries()) {
      if (cId === conversationId) {
        this.callSidToConversationId.delete(callSid);
        break;
      }
    }
    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }
    await this.endConversation(conversationId);
  }
  /**
   * Send voice response via WebSocket
   */
  sendResponse(conversationId, message, metadata) {
    try {
      const ws = this.webSocketConnections.get(conversationId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
      }
      const response = {
        type: "text",
        token: message,
        last: true
      };
      ws.send(JSON.stringify(response));
      return Promise.resolve();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata
      });
      throw error;
    }
  }
  // =========================================================================
  // Incoming Call Handling (with conversation creation)
  // =========================================================================
  /**
   * Handle incoming voice call - create conversation, add participants, generate TwiML
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  async handleIncomingCall(options) {
    const {
      websocketUrl,
      toNumber,
      fromNumber,
      callSid,
      actionUrl,
      welcomeGreeting = "Hello! How can I assist you today?"
    } = options;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const conversationName = `tac-voice-${fromNumber}-${timestamp}`;
    const conversationClient = this.tac.getConversationClient();
    const conversation = await conversationClient.createConversation(conversationName);
    const conversationId = conversation.id;
    this.logger.debug(
      { conversation_id: conversationId, call_sid: callSid },
      "Created conversation for voice call"
    );
    const customerParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: fromNumber, channelId: callSid }],
      "CUSTOMER"
    );
    const profileId = customerParticipant.profileId || "";
    const customerParticipantId = customerParticipant.id;
    const aiAgentParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: toNumber, channelId: callSid }],
      "AI_AGENT"
    );
    const aiAgentParticipantId = aiAgentParticipant.id;
    const actionAttr = actionUrl ? ` action="${actionUrl}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect${actionAttr}>
        <ConversationRelay url="${websocketUrl}" welcomeGreeting="${welcomeGreeting}">
            <Parameter name="conversation_id" value="${conversationId}" />
            <Parameter name="profile_id" value="${profileId}" />
            <Parameter name="customer_participant_id" value="${customerParticipantId}" />
            <Parameter name="ai_agent_participant_id" value="${aiAgentParticipantId}" />
        </ConversationRelay>
    </Connect>
</Response>`;
  }
  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================
  /**
   * Handle ConversationRelay callback from Twilio
   *
   * @param payload - Callback payload from Twilio
   * @param handoffHandler - Optional handler for handoff requests
   * @returns Response with status, content, and content type
   */
  async handleConversationRelayCallback(payload, handoffHandler) {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      "ConversationRelay callback received"
    );
    if (payload.CallStatus === "in-progress" && payload.HandoffData) {
      if (handoffHandler) {
        try {
          const response = await handoffHandler(payload);
          return { status: 200, content: response, contentType: "application/xml" };
        } catch (error) {
          this.logger.error({ err: error }, "Handoff handler failed");
          return { status: 500, content: "Handoff handler error", contentType: "text/plain" };
        }
      }
      return { status: 501, content: "No handoff handler registered", contentType: "text/plain" };
    }
    if (payload.CallStatus === "completed") {
      await this.closeConversationsForCall(payload.CallSid);
    }
    return { status: 200, content: "OK", contentType: "text/plain" };
  }
  /**
   * Close all conversations associated with a call
   */
  async closeConversationsForCall(callSid) {
    try {
      const conversationClient = this.tac.getConversationClient();
      const conversations = await conversationClient.listConversations({ channelId: callSid });
      this.logger.info(
        { call_sid: callSid, count: conversations.length },
        "Closing conversations for completed call"
      );
      for (const conversation of conversations) {
        try {
          await conversationClient.updateConversation(conversation.id, "CLOSED");
          this.logger.debug({ conversation_id: conversation.id }, "Closed conversation");
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversation.id },
            "Failed to close conversation"
          );
        }
      }
    } catch (error) {
      this.logger.error({ err: error, call_sid: callSid }, "Failed to list conversations for call");
    }
  }
  // =========================================================================
  // Stream Task Management
  // =========================================================================
  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns AbortController for the task
   */
  startStreamTask(conversationId) {
    this.cancelStreamTask(conversationId);
    const controller = new AbortController();
    this.streamTasks.set(conversationId, controller);
    this.logger.debug({ conversation_id: conversationId }, "Started stream task");
    return controller;
  }
  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  cancelStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    if (controller) {
      controller.abort();
      this.streamTasks.delete(conversationId);
      this.logger.debug({ conversation_id: conversationId }, "Cancelled stream task");
      return true;
    }
    return false;
  }
  /**
   * Complete a streaming task (remove from tracking)
   *
   * @param conversationId - The conversation ID
   */
  completeStreamTask(conversationId) {
    this.streamTasks.delete(conversationId);
    this.logger.debug({ conversation_id: conversationId }, "Completed stream task");
  }
  /**
   * Check if a stream task is active
   *
   * @param conversationId - The conversation ID
   * @returns true if an active task exists
   */
  hasActiveStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    return controller !== void 0 && !controller.signal.aborted;
  }
  // =========================================================================
  // TwiML Generation (legacy, without conversation creation)
  // =========================================================================
  /**
   * Generate TwiML for incoming calls
   */
  generateTwiML(options) {
    const { websocketUrl, customParameters, welcomeGreeting } = options;
    let customParamsXml = "";
    if (customParameters) {
      for (const [key, value] of Object.entries(customParameters)) {
        if (value !== void 0) {
          customParamsXml += `<Parameter name="${key}" value="${value}" />`;
        }
      }
    }
    const greetingAttr = welcomeGreeting ? ` welcomeGreeting="${welcomeGreeting}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${websocketUrl}"${greetingAttr}>
      ${customParamsXml}
    </ConversationRelay>
  </Connect>
</Response>`;
  }
  /**
   * Extract conversation ID - Not applicable for Voice channel
   */
  extractConversationId(_payload) {
    return null;
  }
  /**
   * Extract profile ID - Not applicable for Voice channel
   */
  extractProfileId(_payload) {
    return null;
  }
  /**
   * Cleanup channel state on shutdown
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal channel state.
   */
  shutdown() {
    this.streamTasks.clear();
    this.webSocketConnections.clear();
    this.callSidToConversationId.clear();
    super.shutdown();
  }
};
var logger = createLogger({ name: "tac-flex" });
function handleFlexHandoffLogic(formData, flexWorkflowSid) {
  if (!flexWorkflowSid) {
    logger.error("No Flex workflow SID configured");
    return {
      success: false,
      status: 400,
      content: "Invalid handoff data",
      contentType: "text/plain"
    };
  }
  const response = new VoiceResponse2();
  const handoffDataRaw = formData["HandoffData"] || "";
  if (handoffDataRaw) {
    let handoffData;
    try {
      handoffData = HandoffDataSchema.parse(JSON.parse(handoffDataRaw));
    } catch (error) {
      logger.error({ err: error }, "Invalid handoff data");
      return {
        success: false,
        status: 400,
        content: "Invalid handoff data",
        contentType: "text/plain"
      };
    }
    const enqueue = response.enqueue({
      workflowSid: flexWorkflowSid
    });
    enqueue.task(
      {
        priority: 5
      },
      JSON.stringify(handoffData)
    );
    logger.debug(
      { workflow_sid: flexWorkflowSid, handoff_data: handoffData },
      "Generated Flex handoff TwiML"
    );
    return {
      success: true,
      status: 200,
      content: response.toString(),
      contentType: "application/xml"
    };
  } else {
    if (formData["CallStatus"] === "completed") {
      return {
        success: true,
        status: 200,
        content: "Call Completed",
        contentType: "application/xml"
      };
    } else {
      return {
        success: false,
        status: 400,
        content: "Handoff Data is Missing",
        contentType: "application/xml"
      };
    }
  }
}

// src/lib/server.ts
var DEFAULT_CONFIG = {
  voice: {
    host: "0.0.0.0",
    port: 3e3,
    path: "/twiml",
    webhookPath: "/voice"
  },
  webhookPaths: {
    sms: "/sms",
    voice: "/voice",
    twiml: "/twiml",
    conversationRelayCallback: "/conversation-relay-callback"
  },
  development: false,
  validateWebhooks: true
};
var TACServer = class {
  fastify;
  tac;
  config;
  constructor(tac, config2 = {}) {
    this.tac = tac;
    this.config = { ...DEFAULT_CONFIG, ...config2 };
    this.fastify = Fastify({
      logger: this.config.development ? {
        level: process.env.LOG_LEVEL || "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true
          }
        }
      } : {
        level: process.env.LOG_LEVEL || "info"
      },
      ...config2.fastify
    });
  }
  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  getWebhookUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "https";
    const host = request.headers["x-forwarded-host"] || request.headers.host || "";
    return `${proto}://${host}${request.url}`;
  }
  /**
   * Register global Twilio webhook signature validation hook
   */
  registerWebhookValidation() {
    if (!this.config.validateWebhooks) {
      return;
    }
    this.fastify.addHook("preHandler", (request, reply, done) => {
      if (request.method === "GET") {
        done();
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().twilioAuthToken;
      let isValid2;
      if (request.url.includes("bodySHA256=")) {
        const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        isValid2 = twilio.validateRequestWithBody(authToken, signature, url, body);
      } else {
        const params = request.body || {};
        isValid2 = twilio.validateRequest(authToken, signature, url, params);
      }
      if (!isValid2) {
        this.fastify.log.warn(
          { url, hasSignature: !!signature },
          "Invalid Twilio webhook signature"
        );
        void reply.code(403).send({ error: "Invalid webhook signature" });
        done();
        return;
      }
      done();
    });
  }
  /**
   * Setup routes
   */
  async setupRoutes() {
    this.fastify.post(
      this.config.webhookPaths.sms || "/sms",
      async (request, reply) => {
        try {
          const smsChannel = this.tac.getChannel("sms");
          if (!smsChannel) {
            await reply.code(500).send({ error: "SMS channel not available" });
            return;
          }
          await smsChannel.processWebhook(request.body);
          await reply.code(200).send({ status: "ok" });
        } catch (error) {
          this.fastify.log.error(
            "SMS webhook error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.twiml || "/twiml",
      async (request, reply) => {
        try {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const formData = request.body;
          const fromNumber = formData["From"] || "";
          const toNumber = formData["To"] || "";
          const callSid = formData["CallSid"] || "";
          const protocol = request.headers["x-forwarded-proto"] || "http";
          const host = request.headers.host;
          const websocketUrl = `${protocol === "https" ? "wss" : "ws"}://${host}${this.config.webhookPaths.voice || "/voice"}`;
          const callbackUrl = `${protocol}://${host}${this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback"}`;
          const twiml = await voiceChannel.handleIncomingCall({
            websocketUrl,
            toNumber,
            fromNumber,
            callSid,
            actionUrl: callbackUrl,
            ...this.config.welcomeGreeting && { welcomeGreeting: this.config.welcomeGreeting }
          });
          await reply.type("application/xml").send(twiml);
        } catch (error) {
          this.fastify.log.error(
            "TwiML generation error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback",
      async (request, reply) => {
        try {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const formData = request.body;
          const parseResult = ConversationRelayCallbackPayloadSchema.safeParse(formData);
          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              "Invalid ConversationRelay callback payload"
            );
            await reply.code(400).send({ error: "Invalid payload" });
            return;
          }
          const result = await voiceChannel.handleConversationRelayCallback(
            parseResult.data,
            this.config.handoffHandler
          );
          await reply.code(result.status).type(result.contentType).send(result.content);
        } catch (error) {
          this.fastify.log.error(
            "ConversationRelay callback error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({ error: "Internal server error" });
        }
      }
    );
    await this.fastify.register((fastify) => {
      fastify.get(
        this.config.webhookPaths.voice || "/voice",
        { websocket: true },
        (socket) => {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            socket.terminate();
            return;
          }
          voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        async (request, reply) => {
          if (!this.tac.isCintelEnabled()) {
            await reply.code(400).send({
              error: "Conversation Intelligence is not enabled",
              message: "Set TWILIO_TAC_CI_CONFIGURATION_ID and memory credentials to enable CI processing"
            });
            return;
          }
          try {
            this.fastify.log.info("Processing Conversation Intelligence webhook");
            const result = await this.tac.processCintelEvent(request.body);
            if (result.success) {
              if (result.skipped) {
                this.fastify.log.debug({ reason: result.skipReason }, "CI event skipped");
              } else {
                this.fastify.log.info(
                  { eventType: result.eventType, createdCount: result.createdCount },
                  "CI event processed"
                );
              }
            } else {
              this.fastify.log.error({ error: result.error }, "CI event processing failed");
            }
            await reply.send(result);
          } catch (error) {
            this.fastify.log.error(
              "CI webhook error: " + (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  }
  /**
   * Start the server
   */
  async start() {
    try {
      await this.fastify.register(formbody);
      await this.fastify.register(websocket);
      await this.fastify.register(gracefulShutdown);
      this.registerWebhookValidation();
      await this.setupRoutes();
      this.fastify.gracefulShutdown(async (signal) => {
        this.fastify.log.info({ signal }, "Received shutdown signal");
        await this.waitForWebSocketsToClose();
        this.tac.shutdown();
      });
      const voiceConfig = VoiceServerConfigSchema.parse(this.config.voice);
      await this.fastify.listen({
        host: voiceConfig.host,
        port: voiceConfig.port
      });
      this.fastify.log.info(
        {
          host: voiceConfig.host,
          port: voiceConfig.port,
          sms_webhook: this.config.webhookPaths.sms,
          twiml_path: this.config.webhookPaths.twiml,
          voice_websocket: this.config.webhookPaths.voice,
          conversation_relay_callback: this.config.webhookPaths.conversationRelayCallback,
          ...this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel
          },
          webhook_validation: this.config.validateWebhooks ? "enabled" : "disabled"
        },
        "TAC Server started"
      );
      if (!this.config.validateWebhooks) {
        this.fastify.log.warn(
          "Webhook signature validation is DISABLED. Enable in production for security."
        );
      }
    } catch (error) {
      this.fastify.log.error({ err: error }, "Failed to start TAC Server");
      throw error;
    }
  }
  /**
   * Wait for all WebSocket connections to close
   */
  async waitForWebSocketsToClose(timeoutMs = 3e4) {
    const wsServer = this.fastify.websocketServer;
    if (!wsServer || wsServer.clients.size === 0) {
      return;
    }
    this.fastify.log.info(
      { websocket_count: wsServer.clients.size },
      "Waiting for WebSocket connections to close..."
    );
    const startTime = Date.now();
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const clientCount = wsServer.clients.size;
        if (clientCount === 0) {
          clearInterval(checkInterval);
          this.fastify.log.info("All WebSocket connections closed");
          resolve();
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this.fastify.log.warn(
            { remaining_websockets: clientCount },
            "Timeout waiting for WebSockets to close, proceeding with shutdown"
          );
          resolve();
          return;
        }
        this.fastify.log.info(
          { remaining_websockets: clientCount },
          "Waiting for WebSockets to close..."
        );
      }, 5e3);
    });
  }
  /**
   * Stop the server gracefully
   */
  async stop() {
    try {
      await this.fastify.close();
      this.fastify.log.info("TAC Server stopped");
    } catch (error) {
      this.fastify.log.error({ err: error }, "Error stopping TAC Server");
      throw error;
    }
  }
};

// ../tools/src/lib/builder.ts
var TACTool = class {
  constructor(name, description, parameters, implementation) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.implementation = implementation;
  }
  /**
   * Convert to OpenAI function calling format
   */
  toOpenAIFormat() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
  /**
   * Convert to Anthropic tool calling format
   */
  toAnthropicFormat() {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters
    };
  }
  /**
   * Convert to JSON string (OpenAI format by default)
   */
  toJSON() {
    return JSON.stringify(this.toOpenAIFormat(), null, 2);
  }
};
function defineTool(name, description, parameters, implementation) {
  if (!name) {
    throw new Error("Tool name is required");
  }
  if (!description) {
    throw new Error("Tool description is required");
  }
  if (!parameters) {
    throw new Error("Tool parameters schema is required");
  }
  if (!implementation) {
    throw new Error("Tool implementation is required");
  }
  return new TACTool(name, description, parameters, implementation);
}

export { AuthorInfoSchema, BaseChannel, BuiltInTools, ChannelTypeSchema, CintelParticipantSchema, CommunicationContentSchema, CommunicationParticipantSchema, CommunicationSchema, ConversationAddressSchema, ConversationClient, ConversationIntelligenceConfigSchema, ConversationParticipantSchema, ConversationRelayCallbackPayloadSchema, ConversationResponseSchema, ConversationSessionSchema, ConversationSummaryItemSchema, CreateConversationSummariesResponseSchema, CreateObservationResponseSchema, CustomParametersSchema, EMPTY_MEMORY_RESPONSE, EnvironmentSchema, EnvironmentVariables, ExecutionDetailsSchema, HandoffDataSchema, IntelligenceConfigurationSchema, InterruptMessageSchema, JSONSchemaSchema, KnowledgeBaseSchema, KnowledgeBaseStatusSchema, KnowledgeChunkResultSchema, KnowledgeClient, KnowledgeSearchResponseSchema, MemoryChannelTypeSchema, MemoryClient, MemoryCommunicationContentSchema, MemoryCommunicationSchema, MemoryDeliveryStatusSchema, MemoryParticipantSchema, MemoryParticipantTypeSchema, MemoryRetrievalRequestSchema, MemoryRetrievalResponseSchema, MessageDirectionSchema, ObservationInfoSchema, OpenAIToolSchema, OperatorProcessingResultSchema, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, ParticipantAddressSchema, ParticipantAddressTypeSchema, ProfileLookupResponseSchema, ProfileResponseSchema, PromptMessageSchema, SMSChannel, SessionInfoSchema, SessionMessageSchema, SetupMessageSchema, SummaryInfoSchema, TAC, TACChannelTypeSchema, TACCommunicationAuthorSchema, TACCommunicationContentSchema, TACCommunicationSchema, TACConfig, TACConfigSchema, TACDeliveryStatusSchema, TACMemoryResponse, TACParticipantTypeSchema, TACServer, TACTool, ToolExecutionResultSchema, TranscriptionSchema, TranscriptionWordSchema, VoiceChannel, VoiceResponseSchema, VoiceServerConfigSchema, WebSocketMessageSchema, computeServiceUrls, createLogger, defineTool, handleFlexHandoffLogic, isConversationId, isParticipantId, isProfileId, external_exports as z };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map