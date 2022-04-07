# Message flow

```mermaid
sequenceDiagram
    actor User
    participant m as Mediator
    participant bg as bgScript
    participant ld as LanguageDetector
    participant tb as TranslationBar
    participant nt as Notification
    participant ntm as NotificationManager
    participant t as Translation
    participant w as Worker
    participant q as Queue
    participant ipt as InPageTranslation
    participant obt as OutboundTranslation
    User->>+m: load page
    m-)+bg: monitorTabLoad
    deactivate m
    bg-)-m: responseMonitorTabLoad
    activate m
    m-)+bg: detectPageLanguage
    deactivate m
    bg->>+ld: detect language
    ld--)-bg: language detected
    bg-)-m: responseDetectPageLanguage
    activate m
    m-)+bg: displayTranslationBar
    bg-)+tb: show
    tb->>nt: init
    tb->>ntm: create
    deactivate tb
    deactivate bg
    m->>+t: create
    deactivate m
    t->>+w: load
    w->>+q: load
    deactivate q
    t->>w: config engine
    deactivate w
    deactivate t
    User->>+nt: enable translate of forms
    User->>nt: press "Translate" button
    nt->>+ntm: request translation
    deactivate nt
    ntm-)-bg: translationRequested
    activate bg
    bg-)-m: translationRequested
    activate m
    m->>+ipt: start
    deactivate m
    deactivate ipt
    activate ipt
    ipt->>+m: translate
    deactivate ipt
    m-)+bg: translate frame
    bg-)-m: pass to top frame
    m->>+t: translate
    deactivate m
    t-)+w: translate
    deactivate t
    w->>w: load engine
    w->>w: load models
    w-)+t: displayOutboundTranslation
    t-)+m: displayOutboundTranslation
    deactivate t
    m-)+bg: displayOutboundTranslation
    bg-)-m: pass to all frames
    m->>+obt: start
    deactivate obt
    deactivate m
    w->>q: enqueue
    w->>q: consume
    w-)+t: translationComplete
    deactivate w
    t->>+m: translationComplete
    deactivate t
    m-)+bg: frame translationComplete
    bg-)-m: pass back to frame
    m->>+ipt: notify
    deactivate m
    ipt->>+ipt: update DOM
    deactivate ipt
    User->>+obt: edit forms
    obt->>+m: translate
    deactivate obt
    deactivate m
    
    
    
    
```
