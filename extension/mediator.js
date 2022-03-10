/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, Translation , browser,
InPageTranslation, browser */

// eslint-disable-next-line max-lines

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.translation = null;
        this.translationsCounter = 0;
        this.languageDetection = new LanguageDetection();
        this.inPageTranslation = new InPageTranslation(this);
        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        this.translationBarDisplayed = false;
        this.statsMode = false;
        // if we are in the protected mochitest page, we flag it.
        if (window.location.href ===
            "https://example.com/browser/browser/extensions/translations/test/browser/browser_translation_test.html") {
            this.isMochitest = true;
        }
    }

    init() {
        if (window.self === window.top) { // is main frame
            browser.runtime.sendMessage({ command: "monitorTabLoad" });
        }
    }

    // main entrypoint to handle the extension's load
    start(tabId) {
        this.tabId = tabId;

        if (window.self === window.top) { // is main frame
            // request the language detection class to extract a page's snippet
            this.languageDetection.extractPageContent();

            /*
             * request the background script to detect the page's language and
             *  determine if the infobar should be displayed
             */
            browser.runtime.sendMessage({
                command: "detectPageLanguage",
                languageDetection: this.languageDetection
            })
        }
    }

    recordTelemetry(type, category, name, value) {
        browser.runtime.sendMessage({
            command: "recordTelemetry",
            tabId: this.tabId,
            type,
            category,
            name,
            value
        });
    }

    // eslint-disable-next-line max-lines-per-function
    determineIfTranslationisRequired() {

        /*
         * here we:
         * - determine if the infobar should be displayed or not and if yes,
         *      notifies the backgroundScript in order to properly
         * - display the views responsible for the translationbar
         * - initiate the outbound translation view and start the translation
         *      webworker
         */

        if (this.languageDetection.isLangMismatch()) {

            /*
             * we need to keep track if the translationbar was already displayed
             * or not, since during tests we found the browser may send the
             * onLoad event twice.
             */
            if (this.translationBarDisplayed) return;

            if (window.self === window.top) { // is main frame
                const pageLang = this.languageDetection.pageLanguage.language;
                const navLang = this.languageDetection.navigatorLanguage;
                this.recordTelemetry("string", "metadata", "from_lang", pageLang);
                this.recordTelemetry("string", "metadata", "to_lang", navLang);
                this.recordTelemetry("counter", "service", "lang_mismatch");

                window.onbeforeunload = () => browser.runtime.sendMessage({ command: "submitPing", tabId: this.tabId });

                if (this.languageDetection.shouldDisplayTranslation()) {
                    // request the backgroundscript to display the translationbar
                    browser.runtime.sendMessage({
                        command: "displayTranslationBar",
                        languageDetection: this.languageDetection,
                        localizedLabels: {
                            displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
                            outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
                            qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage")
                        }
                    });
                    this.translationBarDisplayed = true;
                    // create the translation object
                    this.translation = new Translation(this);
                } else {
                    this.recordTelemetry("counter", "service", "not_supported");
                }
            } else if (this.languageDetection.shouldDisplayTranslation()) {
                    this.translation = new Translation(this);
                    this.translationBarDisplayed = true;
            }
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */

    // eslint-disable-next-line max-lines-per-function
    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "translate":
                // eslint-disable-next-line no-case-declarations
                const translationMessage = this.translation.constructTranslationMessage(
                    message.payload.text,
                    message.payload.type,
                    message.tabId,
                    this.languageDetection.navigatorLanguage,
                    this.languageDetection.pageLanguage.language,
                    message.payload.attrId,
                    message.payload.withOutboundTranslation,
                    message.payload.withQualityEstimation
                );
                this.messagesSenderLookupTable.set(translationMessage.messageID, sender);
                this.translation.translate(translationMessage);
                // console.log("new translation message sent:", translationMessage, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);

                if (message.payload.type === "outbound") {
                    if (!sender.selectedTextArea.id) sender.selectedTextArea.id = self.crypto.randomUUID();
                    browser.runtime.sendMessage({
                        command: "reportOutboundStats",
                        tabId: this.tabId,
                        textAreaId: sender.selectedTextArea.id,
                        text: message.payload.text
                    });
                }
                break;
            case "translationComplete":

                /*
                 * received the translation complete signal
                 * from the translation object. so we lookup the sender
                 * in order to route the response back, which can be
                 * OutbountTranslation, InPageTranslation etc....
                 */
                message.payload[1].forEach(translationMessage => {
                    this.messagesSenderLookupTable.get(translationMessage.messageID)
                        .mediatorNotification(translationMessage);
                    this.messagesSenderLookupTable.delete(translationMessage.messageID);
                });

                browser.runtime.sendMessage({
                    command: "reportTranslationStats",
                    tabId: this.tabId,
                    numWords: message.payload[2][0],
                    engineTimeElapsed: message.payload[2][1]
                });
                // console.log("translation complete rcvd:", message, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);
                break;
            case "updateProgress":

                /*
                 * let's invoke the experiment api in order to update the
                 * model/engine download progress in the appropiate infobar
                 */
                // first we localize the message.
                // eslint-disable-next-line no-case-declarations
                let localizedMessage;
                if (typeof message.payload[1] === "string") {
                    localizedMessage = browser.i18n.getMessage(message.payload[1]);
                } else if (typeof message.payload[1] === "object") {
                    // we have a downloading message, which contains placeholders, hence this special treatment
                    localizedMessage = browser.i18n.getMessage(message.payload[1][0], message.payload[1][1]);
                }

                browser.runtime.sendMessage({
                    command: "updateProgress",
                    progressMessage: localizedMessage,
                    tabId: this.tabId
                });
                break;
            case "displayOutboundTranslation":
                /* display the outboundstranslation widget */
                this.outboundTranslation = new OutboundTranslation(this);
                this.outboundTranslation.start(
                    this.languageDetection.navigatorLanguage,
                    this.languageDetection.pageLanguage.language
                );
                break;
            case "reportError":
                // payload is a metric name from metrics.yaml
                this.recordTelemetry("counter", "errors", message.payload);
                break;
            case "reportViewPortWordsNum":
                this.recordTelemetry("quantity", "performance", "word_count_visible_in_viewport", message.payload);
                break;
            case "reportModelEvent":
                this.recordTelemetry("timespan", "performance", message.payload.metric, message.payload.timeMs);
                break;
            case "reportFormsEvent":
                // payload is a metric name from metrics.yaml
                this.recordTelemetry("event", "forms", message.payload);
                break;
            case "domMutation":
                if (this.outboundTranslation) {
                    this.outboundTranslation.updateZIndex(message.payload);
                }
                break;
            default:
        }
    }

    /*
     * handles all communication received from the background script
     * and properly delegates the calls to the responsible methods
     */

    // eslint-disable-next-line max-lines-per-function
    bgScriptsMessageListener(message) {
        switch (message.command) {
            case "responseMonitorTabLoad":
                this.start(message.tabId);
                break;
            case "responseDetectPageLanguage":
                this.languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
                this.determineIfTranslationisRequired();
                break;
            case "translationRequested":

                /*
                 * here we handle when the user's translation request in the infobar
                 * let's start the in-page translation widget
                 */

                // the user might have changed the page language, so we just accept it
                this.languageDetection.pageLanguage.language = message.from;
                if (!this.inPageTranslation.started) {
                    this.inPageTranslation.withOutboundTranslation = message.withOutboundTranslation;
                    this.inPageTranslation.withQualityEstimation = message.withQualityEstimation;
                    this.inPageTranslation.start(this.languageDetection.pageLanguage.language);
                }
                break;
            case "displayStatistics":
                this.statsMode = true;
                document.querySelector("html").setAttribute("x-bergamot-debug", true);
                break;
            case "updateStats":
                if (this.statsMode) {
                    // if the user chose to see stats in the infobar, we display them
                    browser.runtime.sendMessage({
                        command: "updateProgress",
                        progressMessage: browser.i18n.getMessage("statsMessage", message.wps),
                        tabId: this.tabId
                    });
                }
                break;
            default:
            // ignore
        }
    }
}

const mediator = new Mediator();
mediator.init();