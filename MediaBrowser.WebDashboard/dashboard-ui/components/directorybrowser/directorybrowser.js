﻿define([], function () {

    var systemInfo;
    function getSystemInfo() {

        var deferred = DeferredBuilder.Deferred();

        if (systemInfo) {
            deferred.resolveWith(null, [systemInfo]);
        } else {
            ApiClient.getPublicSystemInfo().done(function (info) {
                systemInfo = info;
                deferred.resolveWith(null, [systemInfo]);
            });
        }

        return deferred.promise();
    }

    function onDialogClosed() {

        $(this).remove();
        Dashboard.hideLoadingMsg();
    }

    function refreshDirectoryBrowser(page, path, fileOptions) {

        Dashboard.showLoadingMsg();

        if (path) {
            $('.networkHeadline').hide();
        } else {
            $('.networkHeadline').show();
        }

        var promise;

        var parentPathPromise = null;

        if (path === "Network") {
            promise = ApiClient.getNetworkDevices();
        }
        else if (path) {
            promise = ApiClient.getDirectoryContents(path, fileOptions);
            parentPathPromise = ApiClient.getParentPath(path);
        } else {
            promise = ApiClient.getDrives();
        }

        if (!parentPathPromise) {
            parentPathPromise = $.Deferred();
            parentPathPromise.resolveWith(null, []);
            parentPathPromise = parentPathPromise.promise();
        }

        $.when(promise, parentPathPromise).done(function (response1, response2) {

            var folders = response1[0];
            var parentPath = response2 && response2.length ? response2[0] || '' : '';

            $('#txtDirectoryPickerPath', page).val(path || "");

            var html = '';

            if (path) {

                html += '<paper-item role="menuitem" class="lnkPath lnkDirectory" data-path="' + parentPath + '">';
                html += '<paper-item-body>';
                html += '...';
                html += '</paper-item-body>';
                html += '<iron-icon icon="arrow-forward"></iron-icon>';
                html += '</paper-item>';
            }

            for (var i = 0, length = folders.length; i < length; i++) {

                var folder = folders[i];

                var cssClass = folder.Type == "File" ? "lnkPath lnkFile" : "lnkPath lnkDirectory";

                html += '<paper-item role="menuitem" class="' + cssClass + '" data-type="' + folder.Type + '" data-path="' + folder.Path + '">';
                html += '<paper-item-body>';
                html += folder.Name;
                html += '</paper-item-body>';
                html += '<iron-icon icon="arrow-forward"></iron-icon>';
                html += '</paper-item>';
            }

            if (!path) {
                html += '<paper-item role="menuitem" class="lnkPath lnkDirectory" data-path="Network">';
                html += '<paper-item-body>';
                html += Globalize.translate('ButtonNetwork');
                html += '</paper-item-body>';
                html += '<iron-icon icon="arrow-forward"></iron-icon>';
                html += '</paper-item>';
            }

            $('.results', page).html(html);

            Dashboard.hideLoadingMsg();

        }).fail(function () {

            $('#txtDirectoryPickerPath', page).val("");
            $('.results', page).html('');

            Dashboard.hideLoadingMsg();
        });
    }

    function getEditorHtml(options, systemInfo) {

        var html = '';

        var instruction = options.instruction ? options.instruction + '<br/><br/>' : '';

        html += '<p class="directoryPickerHeadline">';
        html += instruction;
        html += Globalize.translate('MessageDirectoryPickerInstruction')
            .replace('{0}', '<b>\\\\server</b>')
            .replace('{1}', '<b>\\\\192.168.1.101</b>');

        if (systemInfo.OperatingSystem.toLowerCase() == 'bsd') {

            html += '<br/>';
            html += '<br/>';
            html += Globalize.translate('MessageDirectoryPickerBSDInstruction');
            html += '<br/>';
            html += '<a href="http://doc.freenas.org/9.3/freenas_jails.html#add-storage" target="_blank">' + Globalize.translate('ButtonMoreInformation') + '</a>';
        }

        html += '</p>';

        html += '<form style="max-width:100%;">';
        html += '<div>';
        html += '<paper-input id="txtDirectoryPickerPath" type="text" required="required" style="width:82%;display:inline-block;" label="' + Globalize.translate('LabelCurrentPath') + '"></paper-input>';

        html += '<paper-icon-button icon="refresh" class="btnRefreshDirectories" title="' + Globalize.translate('ButtonRefresh') + '"></paper-icon-button>';
        html += '</div>';

        html += '<div class="results paperList" style="height: 180px; overflow-y: auto;"></div>';

        html += '<div>';
        html += '<button type="submit" class="clearButton" data-role="none"><paper-button raised class="submit block">' + Globalize.translate('ButtonOk') + '</paper-button></button>';
        html += '</div>';

        html += '</form>';
        html += '</div>';

        return html;
    }

    function initEditor(content, options, fileOptions) {

        $(content).on("click", ".lnkPath", function () {

            var path = this.getAttribute('data-path');

            if ($(this).hasClass('lnkFile')) {
                $('#txtDirectoryPickerPath', content).val(path);
            } else {
                refreshDirectoryBrowser(content, path, fileOptions);
            }


        }).on("click", ".btnRefreshDirectories", function () {

            var path = $('#txtDirectoryPickerPath', content).val();

            refreshDirectoryBrowser(content, path, fileOptions);

        }).on("change", "#txtDirectoryPickerPath", function () {

            refreshDirectoryBrowser(content, this.value, fileOptions);
        });

        $('form', content).on('submit', function () {

            if (options.callback) {
                options.callback(this.querySelector('#txtDirectoryPickerPath').value);
            }

            return false;
        });
    }

    function directoryBrowser() {

        var self = this;
        var currentDialog;

        self.show = function (options) {

            options = options || {};

            var fileOptions = {
                includeDirectories: true
            };

            if (options.includeDirectories != null) {
                fileOptions.includeDirectories = options.includeDirectories;
            }

            if (options.includeFiles != null) {
                fileOptions.includeFiles = options.includeFiles;
            }

            getSystemInfo().done(function (systemInfo) {

                require(['components/paperdialoghelper'], function () {

                    var dlg = PaperDialogHelper.createDialog({
                        theme: 'a',
                        size: 'medium'
                    });

                    dlg.classList.add('directoryPicker');

                    var html = '';
                    html += '<h2 class="dialogHeader">';
                    html += '<paper-fab icon="arrow-back" class="mini btnCloseDialog"></paper-fab>';
                    html += '<div style="display:inline-block;margin-left:.6em;vertical-align:middle;">' + (options.header || Globalize.translate('HeaderSelectPath')) + '</div>';
                    html += '</h2>';

                    html += '<div class="editorContent" style="max-width:800px;margin:auto;">';
                    html += getEditorHtml(options, systemInfo);
                    html += '</div>';

                    dlg.innerHTML = html;
                    document.body.appendChild(dlg);

                    var editorContent = dlg.querySelector('.editorContent');
                    initEditor(editorContent, options, fileOptions);

                    // Has to be assigned a z-index after the call to .open() 
                    $(dlg).on('iron-overlay-opened', function () {
                        this.querySelector('#txtDirectoryPickerPath input').focus();
                    });
                    $(dlg).on('iron-overlay-closed', onDialogClosed);

                    PaperDialogHelper.openWithHash(dlg, 'directorybrowser');

                    $('.btnCloseDialog', dlg).on('click', function () {

                        PaperDialogHelper.close(dlg);
                    });

                    currentDialog = dlg;

                    var txtCurrentPath = $('#txtDirectoryPickerPath', editorContent);

                    if (options.path) {
                        txtCurrentPath.val(options.path);
                    }

                    refreshDirectoryBrowser(editorContent, txtCurrentPath.val());
                });

            });
        };

        self.close = function () {
            if (currentDialog) {
                PaperDialogHelper.close(currentDialog);
            }
        };

    }

    return directoryBrowser;
});