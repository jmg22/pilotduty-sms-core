"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BODY_LENGTH = exports.createSmsGateway = exports.FIRST_CONTACT_WINDOW_DAYS = exports.STOP_FOOTERS = exports.baseLanguage = exports.footerFor = exports.applyFooter = exports.decideFooter = exports.renderTemplate = exports.isPermanentTwilioError = exports.describeTwilioError = exports.classifyTwilioError = exports.wallClock = exports.zonedTimeToUtc = exports.localHour = exports.isValidTimeZone = exports.nextQuietHoursEnd = exports.isWithinQuietHours = exports.DEFAULT_QUIET_HOURS = exports.decideConsent = exports.HELP_KEYWORDS = exports.OPT_IN_KEYWORDS = exports.OPT_OUT_KEYWORDS = exports.normalizeKeyword = exports.classifyInboundKeyword = exports.SMS_LIMITS = exports.isGsm7 = exports.detectSmsEncoding = exports.calculateSmsSegments = exports.DEFAULT_PHONE_COUNTRY = exports.toE164 = exports.isSmsCapablePhone = exports.normalizePhone = void 0;
__exportStar(require("./types"), exports);
var phone_1 = require("./phone");
Object.defineProperty(exports, "normalizePhone", { enumerable: true, get: function () { return phone_1.normalizePhone; } });
Object.defineProperty(exports, "isSmsCapablePhone", { enumerable: true, get: function () { return phone_1.isSmsCapablePhone; } });
Object.defineProperty(exports, "toE164", { enumerable: true, get: function () { return phone_1.toE164; } });
Object.defineProperty(exports, "DEFAULT_PHONE_COUNTRY", { enumerable: true, get: function () { return phone_1.DEFAULT_PHONE_COUNTRY; } });
var segments_1 = require("./segments");
Object.defineProperty(exports, "calculateSmsSegments", { enumerable: true, get: function () { return segments_1.calculateSmsSegments; } });
Object.defineProperty(exports, "detectSmsEncoding", { enumerable: true, get: function () { return segments_1.detectSmsEncoding; } });
Object.defineProperty(exports, "isGsm7", { enumerable: true, get: function () { return segments_1.isGsm7; } });
Object.defineProperty(exports, "SMS_LIMITS", { enumerable: true, get: function () { return segments_1.SMS_LIMITS; } });
var keywords_1 = require("./keywords");
Object.defineProperty(exports, "classifyInboundKeyword", { enumerable: true, get: function () { return keywords_1.classifyInboundKeyword; } });
Object.defineProperty(exports, "normalizeKeyword", { enumerable: true, get: function () { return keywords_1.normalizeKeyword; } });
Object.defineProperty(exports, "OPT_OUT_KEYWORDS", { enumerable: true, get: function () { return keywords_1.OPT_OUT_KEYWORDS; } });
Object.defineProperty(exports, "OPT_IN_KEYWORDS", { enumerable: true, get: function () { return keywords_1.OPT_IN_KEYWORDS; } });
Object.defineProperty(exports, "HELP_KEYWORDS", { enumerable: true, get: function () { return keywords_1.HELP_KEYWORDS; } });
var consent_1 = require("./consent");
Object.defineProperty(exports, "decideConsent", { enumerable: true, get: function () { return consent_1.decideConsent; } });
var quiet_hours_1 = require("./quiet-hours");
Object.defineProperty(exports, "DEFAULT_QUIET_HOURS", { enumerable: true, get: function () { return quiet_hours_1.DEFAULT_QUIET_HOURS; } });
Object.defineProperty(exports, "isWithinQuietHours", { enumerable: true, get: function () { return quiet_hours_1.isWithinQuietHours; } });
Object.defineProperty(exports, "nextQuietHoursEnd", { enumerable: true, get: function () { return quiet_hours_1.nextQuietHoursEnd; } });
Object.defineProperty(exports, "isValidTimeZone", { enumerable: true, get: function () { return quiet_hours_1.isValidTimeZone; } });
Object.defineProperty(exports, "localHour", { enumerable: true, get: function () { return quiet_hours_1.localHour; } });
Object.defineProperty(exports, "zonedTimeToUtc", { enumerable: true, get: function () { return quiet_hours_1.zonedTimeToUtc; } });
Object.defineProperty(exports, "wallClock", { enumerable: true, get: function () { return quiet_hours_1.wallClock; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "classifyTwilioError", { enumerable: true, get: function () { return errors_1.classifyTwilioError; } });
Object.defineProperty(exports, "describeTwilioError", { enumerable: true, get: function () { return errors_1.describeTwilioError; } });
Object.defineProperty(exports, "isPermanentTwilioError", { enumerable: true, get: function () { return errors_1.isPermanentTwilioError; } });
var template_1 = require("./template");
Object.defineProperty(exports, "renderTemplate", { enumerable: true, get: function () { return template_1.renderTemplate; } });
Object.defineProperty(exports, "decideFooter", { enumerable: true, get: function () { return template_1.decideFooter; } });
Object.defineProperty(exports, "applyFooter", { enumerable: true, get: function () { return template_1.applyFooter; } });
Object.defineProperty(exports, "footerFor", { enumerable: true, get: function () { return template_1.footerFor; } });
Object.defineProperty(exports, "baseLanguage", { enumerable: true, get: function () { return template_1.baseLanguage; } });
Object.defineProperty(exports, "STOP_FOOTERS", { enumerable: true, get: function () { return template_1.STOP_FOOTERS; } });
Object.defineProperty(exports, "FIRST_CONTACT_WINDOW_DAYS", { enumerable: true, get: function () { return template_1.FIRST_CONTACT_WINDOW_DAYS; } });
var gateway_1 = require("./gateway");
Object.defineProperty(exports, "createSmsGateway", { enumerable: true, get: function () { return gateway_1.createSmsGateway; } });
Object.defineProperty(exports, "MAX_BODY_LENGTH", { enumerable: true, get: function () { return gateway_1.MAX_BODY_LENGTH; } });
//# sourceMappingURL=index.js.map