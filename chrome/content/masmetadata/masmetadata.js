Zotero.MASMetaData = new function () {
    const _citeCountStrLength = 7;
    const _extraPrefix = 'ECC';
    const _extraEntrySep = ' \n';
    const _noData = 'No MAS Data';
    const _baseUrl = 'https://api.labs.cognitive.microsoft.com/academic/v1.0';
    const _extraRegex = new RegExp( // TODO understand this regex
        '^(?:(?:' + _extraPrefix + ': )?)'
        + '((?:(?:\\d{'
        + _citeCountStrLength +
        '}|'
        + _noData +
        ')|(?:\\d{5}|No Citation Data))?)'
        + '\\[?s?(\\d|)\\]?'
        + '([^]*)$'
    );
    const self = this;

    // Startup - initialize plugin

    this.init = function () {
        this.resetState('initial');

        // Register callbacks in Zotero as item observers
        if (this.notifierID == null)
            this.notifierID = Zotero.Notifier.registerObserver(this.notifierCallback, ['item']);
        // Unregister callback when the window closes (important to avoid a memory leak)
        window.addEventListener('unload', function (e) {
            Zotero.Notifier.unregisterObserver(self.notifierID);
            self.notifierID = null;
        }, false);

    };

    this.notifierCallback = {
        notify: function (event, type, ids, extraData) {
            if (type == 'item' && event == 'add' && getPref('autoretrieve')) {
                self.updateItems(Zotero.Items.get(ids), 'update');
            };
        }
    };

    /**
     * Open masmetadata preference window
     */
    this.openPreferenceWindow = function (paneID, action) {
        let io = { pane: paneID, action: action };
        window.openDialog('chrome://masmetadata/content/options.xul',
            'masmetadata-pref',
            'chrome,titlebar,toolbar,centerscreen' + Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal', io
        );
    };

    this.setPrefToDefault = function (pref) {
        clearPref(pref);
    };

    /** Update logic */

    this.resetState = function (operation) {
        if (this.progressWin) {
            this.progressWin.close();
        };
        switch (operation) {
            case 'error':
                icon = 'chrome://zotero/skin/cross.png';
                resetWindow = new this.ProgressWindow();
                resetWindow.changeHeadline('Error');
                resetWindow.progress = new resetWindow.ItemProgress(icon, 'Something went wrong.');
                resetWindow.progress.setError();
                resetWindow.show();
                resetWindow.startCloseTimer(4000);
                break;
            case 'update':
                icon = 'chrome://zotero/skin/tick.png';
                resetWindow = new this.ProgressWindow();
                resetWindow.changeHeadline('Finished');
                resetWindow.progress = new resetWindow.ItemProgress(icon);
                resetWindow.progress.setProgress(100);
                resetWindow.progress.setText(this.numberOfUpdatedItems + ' of ' + this.numberOfItemsToUpdate + ' citation count(s) updated.');
                resetWindow.show();
                resetWindow.startCloseTimer(4000);
                break;
            case 'remove':
                icon = 'chrome://zotero/skin/tick.png';
                resetWindow = new this.ProgressWindow();
                resetWindow.changeHeadline('Finished');
                resetWindow.progress = new resetWindow.ItemProgress(icon);
                resetWindow.progress.setProgress(100);
                resetWindow.progress.setText(this.numberOfUpdatedItems + ' citation count(s) removed.');
                resetWindow.show();
                resetWindow.startCloseTimer(4000);
                break;
            case 'abort':
                icon = 'chrome://zotero/skin/cross.png';
                resetWindow = new this.ProgressWindow();
                resetWindow.changeHeadline('Aborted');
                resetWindow.progress = new resetWindow.ItemProgress(icon);
                resetWindow.progress.setProgress(100);
                resetWindow.progress.setText(this.numberOfUpdatedItems + ' of ' + this.numberOfItemsToUpdate + ' citation count(s) updated.');
                resetWindow.show();
                resetWindow.startCloseTimer(4000);
                break;
            default:
                break;
        };
        this.numberOfItemsToUpdate = 0;
        this.itemsToUpdate = null;
        this.currentItemIndex = 0;
        this.numberOfUpdatedItems = 0;
        this.currentRequest = null;
        this.currentRequestAborted = false;
    };

    this.updateSelectedItems = function (operation) {
        this.updateItems(ZoteroPane.getSelectedItems(), operation);
    };

    function itemHasField(item, field) {
        return Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field), item.itemTypeID);
    }

    this.updateItems = function (items, operation) {
        //TODO is this enough filter?
        // items = items.filter(item => item.itemTypeID != Zotero.ItemTypes.getID('attachment'));
        // items = items.filter(item => item.isTopLevelItem());
        items = items.filter(item => item.getField('title'));
        items = items.filter(item => itemHasField(item, 'extra'));

        if (items.length === 0 ||
            this.currentItemIndex < this.numberOfItemsToUpdate) {
            return;
        };

        this.resetState('initial');
        this.numberOfItemsToUpdate = items.length;
        this.itemsToUpdate = items;

        // Progress Windows
        this.progressWin = new this.ProgressWindow({ callOnClick: [] });
        let icon = 'chrome://zotero/skin/toolbar-advanced-search' + (Zotero.hiDPI ? '@2x' : '') + '.png';
        let headline = '';
        switch (operation) {
            case 'update':
                headline = 'Getting citations counts';
                break;
            case 'remove':
                headline = 'Removing citation counts';
                break;
            default:
                headline = 'Default headline';
                break;
        }
        this.progressWin.changeHeadline(headline, icon);
        this.progressWin.progress = new this.progressWin.ItemProgress();
        this.progressWin.show();
        this.progressWin.getProgressWindow().addEventListener('mouseup', function () {
            self.currentRequestAborted = true;
            if (self.currentRequest) {
                self.currentRequest.abort();
            };
        }, false);

        this.updateNextItem(operation);
    };

    this.updateNextItem = function (operation) {
        this.currentItemIndex++;

        if (this.currentItemIndex > this.numberOfItemsToUpdate) {
            this.resetState(operation);
            return;
        };

        // Progress Windows
        let percent = Math.round(((this.currentItemIndex - 1) / this.numberOfItemsToUpdate) * 100);
        this.progressWin.progress.setProgress(percent);
        this.progressWin.progress.setText('Update Item ' + this.currentItemIndex + ' of ' + this.numberOfItemsToUpdate + ' (click to abort)');

        this.updateItem(
            this.itemsToUpdate[this.currentItemIndex - 1], operation);
    };

    this.updateItem = function (item, operation) {
        switch (operation) {
            case 'update':
                this.interpretQuery(item, operation);
                break;
            case 'remove':
                this.removeMetaData(item, operation);
                break;
            default:
                break;
        };
    };

    this.removeMetaData = function (item, operation) {
        this.removeCitation(item);
        this.updateNextItem(operation);
    };

    function formatParams(params) {
        return '?' + Object
            .keys(params)
            .map(function (key) {
                return key + '=' + params[key]
            })
            .join('&');
    };

    /** Make API Requests */

    this.interpretQuery = function (item, operation) {
        let request_type = '/interpret';
        let title = item.getField('title');
        let year = item.getField('year');
        let creators = item.getCreators();
        let query = title;
        // adding creators seems to make interpreter worse at detecting if paper doenst exit
        // if (creators && creators.length > 0) {
        //     for (const creator of creators) {
        //         query += ' '
        //         + creator.firstName.toLowerCase()
        //         + ' '
        //         + creator.lastName.toLowerCase()
        //     }
        // }
        if (year) query += ' ' + year;
        let params = {
            // Request parameters
            'query': query,
            'complete': '0',
            'count': '1',
            // 'offset': '{number}',
            // 'timeout': '{number}',
            'model': 'latest',
        };
        let url = _baseUrl + request_type + formatParams(params);
        if (isDebug()) Zotero.debug('[mas-metadata]: The url for MAS query: ' + url);
        let req = new XMLHttpRequest();
        req.open('GET', url, true);
        req.setRequestHeader('Ocp-Apim-Subscription-Key', getPref('mas-api-key'));
        req.responseType = 'json';
        // req.addEventListener('progress', updateProgress);
        req.addEventListener('loadend', requestComplete);
        req.addEventListener('load', requestSucceeded);
        req.addEventListener('error', requestFailed);
        req.addEventListener('abort', requestCanceled);
        req.send();
        this.currentRequest = req;
        if (this.currentRequestAborted) {
            req.abort();
        };
        function requestComplete(evt) {
            if (self.currentRequest === req) {
                self.currentRequest = null;
            };
        };
        function requestSucceeded(evt) {
            res = req.response;
            switch (this.status) {
                case 200:
                    if (!res.aborted && res.interpretations.length > 0) {
                        let intp = res.interpretations[0];
                        if (intp.logprob > getPref('logprob')) {
                            let expr = intp.rules[0].output.value;
                            self.evaluateExpr(item, expr, operation);
                        } else {
                            self.updateCitation(item, -1); // TODO print logprob
                            self.updateNextItem(operation);
                        }
                    } else {
                        self.resetState('error');
                        alert('MAS api request was aborted.');
                    };
                    break;
                default:
                    self.resetState('error');
                    if (res.error) {
                        let error = res.error;
                        alert('ERROR: ' + this.status + '\n'
                            + 'Code: ' + error.code + '\n'
                            + 'Message: ' + error.message);
                    } else {
                        alert(JSON.stringify(res));
                    }
                    break;
            };
        };
    };

    this.evaluateExpr = function (item, expr, operation) {
        request_type = '/evaluate';
        let params = {
            // Request parameters
            'expr': expr,
            'model': 'latest',
            'count': '1',
            'offset': '0',
            // 'orderby': '{string}',
            'attributes': 'CC,ECC',
        };
        let url = _baseUrl + request_type + formatParams(params);
        if (isDebug()) Zotero.debug('[mas-metadata]: The url for MAS evaluate: ' + url);
        let req = new XMLHttpRequest();
        req.open('GET', url, true);
        req.setRequestHeader('Ocp-Apim-Subscription-Key', getPref('mas-api-key'));
        req.responseType = 'json';
        req.addEventListener('loadend', requestComplete);
        req.addEventListener('load', requestSucceeded);
        req.addEventListener('error', requestFailed);
        req.addEventListener('abort', requestCanceled);
        req.send();
        this.currentRequest = req;
        if (this.currentRequestAborted) {
            req.abort();
        };
        function requestComplete(evt) {
            if (self.currentRequest === req) {
                self.currentRequest = null;
            };
        };
        function requestSucceeded(evt) {
            res = req.response;
            switch (this.status) {
                case 200:
                    if (!res.aborted && res.entities.length > 0) {
                        let ecc = res.entities[0].ECC;
                        self.updateCitation(item, ecc);
                        self.updateNextItem(operation);
                    } else {
                        self.resetState('error');
                        alert('MAS api request was aborted.');
                    }
                    break;
                default:
                    self.resetState('error');
                    if (res.error) {
                        let error = res.error;
                        alert('ERROR: ' + this.status + '\n'
                            + 'Code: ' + error.code + '\n'
                            + 'Message: ' + error.message);
                    } else {
                        alert(JSON.stringify(res));
                    }
                    break;
            };
        };
    };

    /** Change Extra Field */

    this.removeCitation = function (item) {
        let curExtra = item.getField('extra');
        let matches = curExtra.match(_extraRegex);
        let newExtra = matches[3];

        if (curExtra != newExtra) {
            this.numberOfUpdatedItems++;
        }

        item.setField('extra', newExtra);

        try { item.saveTx(); } catch (e) {
            if (isDebug()) Zotero.debug('[mas-metadata] '
                + 'could not update extra content: ' + e);
        }
    };

    this.updateCitation = function (item, citeCount) {
        let curExtra = item.getField('extra');
        let matches = curExtra.match(_extraRegex);
        let newExtra = '';
        newExtra += this.buildCiteCountString(citeCount);
        this.numberOfUpdatedItems++; // TODO: check if this counter can be improved e.g. give more informaiton than currently 
        if (isDebug()) Zotero.debug('[mas-metadata] '
            + 'updating extra field with new cite count');
            
        // TODO make this cleaner related to regex
        if (/^\s\n/.test(matches[3]) || matches[3] === '') {
            // do nothing, since the separator is already correct or not needed at all
        } else if (/^\n/.test(matches[3])) {
            newExtra += ' ';
        } else {
            newExtra += _extraEntrySep;
        }
        newExtra += matches[3];

        item.setField('extra', newExtra);

        try { item.saveTx(); } catch (e) {
            if (isDebug()) Zotero.debug('[mas-metadata] '
                + 'could not update extra content: ' + e);
        }
    };

    this.padLeftWithZeroes = function (numStr) {
        let output = '';
        let cnt = _citeCountStrLength - numStr.length;
        for (let i = 0; i < cnt; i++) { output += '0'; };
        output += numStr;
        return output;
    };

    this.buildCiteCountString = function (citeCount) {
        if (citeCount < 0)
            return _extraPrefix + ': ' + _noData;
        else
            return _extraPrefix + ': ' + this.padLeftWithZeroes(citeCount.toString());
    };

    this.buildStalenessString = function (stalenessCount) {
        return '[s' + stalenessCount + ']';
    };

    /** Functions */

    // Preference managers
    function getPref(pref) {
        return Zotero.Prefs.get('extensions.masmetadata.' + pref, true);
    };

    function setPref(pref, value) {
        return Zotero.Prefs.set('extensions.masmetadata.' + pref, value, true);
    };

    function clearPref(pref) {
        return Zotero.Prefs.clear('extensions.masmetadata.' + pref, true);
    };

    // check if debug mode is enabled
    function isDebug() {
        return typeof Zotero != 'undefined'
            && typeof Zotero.Debug != 'undefined'
            && Zotero.Debug.enabled;
    };

    // Request Handlers
    function requestFailed(evt) {
        self.resetState('error');
        alert(evt); //TODO: check if this is fine
    };
    
    function requestCanceled(evt) {
        self.currentRequestAborted = false;
        self.resetState('abort');
    };
};