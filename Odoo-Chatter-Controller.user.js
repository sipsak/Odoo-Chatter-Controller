// ==UserScript==
// @name            Odoo Chatter Controller
// @name:tr         Odoo Chatter Kontrolcüsü
// @namespace       https://github.com/sipsak
// @version         1.1
// @description     Adds button to move Chatter and allows resizing when in side position
// @description:tr  Odoo'da Chatter'ı taşımak ve boyutlandırmak için özellikler ekler
// @author          Burak Şipşak
// @match           https://portal.bskhvac.com.tr/*
// @match           https://*.odoo.com/*
// @grant           none
// @icon            https://raw.githubusercontent.com/sipsak/odoo-image-enlarger/refs/heads/main/icon.png
// @updateURL       https://raw.githubusercontent.com/sipsak/Odoo-Chatter-Controller/main/Odoo-Chatter-Controller.user.js
// @downloadURL     https://raw.githubusercontent.com/sipsak/Odoo-Chatter-Controller/main/Odoo-Chatter-Controller.user.js
// ==/UserScript==

(function() {
  'use strict';

  let originalParent = null,
      originalNextSibling = null,
      controlButton = null,
      resizeHandle = null,
      isResizing = false,
      startX = 0,
      startWidth = 0,
      currentFormView = null,
      currentChatterContainer = null,
      currentFormSheetBg = null,
      resizeEventsAttached = false,
      initializationAttempts = 0,
      lastChatterWidth = null,
      hasBeenResized = false,
      initialFormSheetWidth = null,
      initialChatterWidth = null,
      originalAttachmentPreview = null,
      isAccountMovePage = false;

  const DEFAULT_CHATTER_WIDTH = 400;
  const MAX_INITIALIZATION_ATTEMPTS = 10;
  const STORAGE_KEY = 'odooChatterPosition';
  const STORAGE_WIDTH_KEY = 'odooChatterWidth';

  function isAccountMoveWithAttachment() {
    // URL'de 'model=account.move' kontrolü
    const isAccountMove = window.location.href.includes('model=account.move');
    // o_attachment_preview sınıfı kontrolü
    const hasAttachmentPreview = !!document.querySelector('.o_attachment_preview');
    return isAccountMove && hasAttachmentPreview;
  }

  function updateButtonIcon(isAtBottom) {
    if (!controlButton) return;
    const icon = controlButton.querySelector('i');
    if (icon) {
      icon.className = `fa fa-lg ${isAtBottom ? 'fa-eye' : 'fa-eye-slash'}`;
    }
  }

  function saveInitialState() {
    const formSheetBg = document.querySelector('.o_form_sheet_bg'),
          chatterContainer = document.querySelector('.o-mail-ChatterContainer');
    if (formSheetBg && !initialFormSheetWidth) {
      initialFormSheetWidth = formSheetBg.offsetWidth;
    }
    if (chatterContainer && !initialChatterWidth) {
      initialChatterWidth = chatterContainer.offsetWidth;
      const savedWidth = parseInt(localStorage.getItem(STORAGE_WIDTH_KEY));
      lastChatterWidth = (savedWidth && !isNaN(savedWidth)) ? savedWidth : initialChatterWidth;
    }
    hasBeenResized = false;
  }

  function addControlButton() {
    const menu = document.querySelector('.o_menu_systray');
    if (!menu) return false;
    if (document.querySelector('.chatter-control-button')) return true;

    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'o-dropdown dropdown o-mail-DiscussSystray-class o-dropdown--no-caret chatter-control-button';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropdown-toggle';
    button.style.padding = '8px';
    button.title = 'Chatter Konumunu Değiştir';

    const icon = document.createElement('i');
    icon.className = 'fa fa-lg fa-eye-slash';
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', 'Chatter Konumunu Değiştir');

    button.appendChild(icon);
    buttonDiv.appendChild(button);

    const firstIcon = menu.querySelector('.o-dropdown.dropdown');
    if (firstIcon) {
      menu.insertBefore(buttonDiv, firstIcon);
    } else {
      menu.appendChild(buttonDiv);
    }

    controlButton = buttonDiv;
    button.addEventListener('click', () => toggleChatterPosition(true));
    updateButtonVisibility();
    return true;
  }

  function updateButtonVisibility() {
    const mailChatter = document.querySelector('.o-mail-Chatter');
    if (controlButton) {
      controlButton.style.display = mailChatter ? '' : 'none';
    }
  }

  function resetChatterWidth() {
    const formView = document.querySelector('.o_form_view'),
          chatterContainer = document.querySelector('.o-mail-ChatterContainer'),
          formSheetBg = document.querySelector('.o_form_sheet_bg');
    if (formView && chatterContainer && formSheetBg) {
      const targetChatterWidth = initialChatterWidth || DEFAULT_CHATTER_WIDTH;
      const targetFormWidth = initialFormSheetWidth || (formView.offsetWidth - targetChatterWidth);
      chatterContainer.style.width = `${targetChatterWidth}px`;
      formSheetBg.style.maxWidth = `${targetFormWidth}px`;
      lastChatterWidth = targetChatterWidth;
      hasBeenResized = false;
      localStorage.setItem(STORAGE_WIDTH_KEY, targetChatterWidth);
    }
  }

  function createResizeHandle() {
    const existingHandle = document.getElementById('chatter-resize-handle');
    if (existingHandle) existingHandle.remove();

    resizeHandle = document.createElement('div');
    resizeHandle.id = 'chatter-resize-handle';

    if (!document.getElementById('resize-handle-style')) {
      const style = document.createElement('style');
      style.id = 'resize-handle-style';
      style.textContent = `
        #chatter-resize-handle {
          width: 4px;
          background-color: #e2e2e2;
          cursor: col-resize;
          position: absolute;
          top: 0;
          bottom: 0;
          left: -2px;
          transition: background-color 0.2s;
          z-index: 100;
        }
        #chatter-resize-handle:hover {
          background-color: #0d6efd;
        }
        .o-mail-Chatter {
          position: relative;
        }
      `;
      document.head.appendChild(style);
    }

    resizeHandle.addEventListener('mousedown', startResize);
    resizeHandle.addEventListener('dblclick', resetChatterWidth);
    if (!resizeEventsAttached) {
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
      resizeEventsAttached = true;
    }
    const chatter = document.querySelector('.o-mail-Chatter');
    if (chatter) {
      chatter.appendChild(resizeHandle);
      return true;
    }
    return false;
  }

  function startResize(e) {
    isResizing = true;
    startX = e.pageX;
    currentFormView = document.querySelector('.o_form_view');
    currentChatterContainer = document.querySelector('.o-mail-ChatterContainer');
    currentFormSheetBg = document.querySelector('.o_form_sheet_bg');
    if (!currentFormView || !currentChatterContainer || !currentFormSheetBg) return;
    startWidth = currentFormView.offsetWidth - currentChatterContainer.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    currentFormSheetBg.style.transition = 'none';
    currentChatterContainer.style.transition = 'none';
  }

  function resize(e) {
    if (!isResizing || !currentFormView || !currentChatterContainer || !currentFormSheetBg) return;
    const minWidth = 200,
          maxWidth = currentFormView.offsetWidth - 400;
    let newWidth = currentFormView.offsetWidth - (startWidth + (e.pageX - startX));
    newWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
    currentChatterContainer.style.width = `${newWidth}px`;
    currentFormSheetBg.style.maxWidth = `${currentFormView.offsetWidth - newWidth}px`;
    lastChatterWidth = newWidth;
    hasBeenResized = true;
    localStorage.setItem(STORAGE_WIDTH_KEY, newWidth);
  }

  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (currentFormSheetBg) currentFormSheetBg.style.transition = '';
    if (currentChatterContainer) currentChatterContainer.style.transition = '';
    currentFormView = currentChatterContainer = currentFormSheetBg = null;
  }

  function saveChatterPosition(isAtBottom) {
    localStorage.setItem(STORAGE_KEY, isAtBottom ? 'bottom' : 'side');
  }

  function getChatterPosition() {
    return localStorage.getItem(STORAGE_KEY) || 'side';
  }

  function checkChatterPosition() {
    const chatterContainer = document.querySelector('.o-mail-ChatterContainer.o-mail-Form-chatter'),
          mailChatter = document.querySelector('.o-mail-Chatter');
    if (!mailChatter) {
      updateButtonVisibility();
      return false;
    }
    updateButtonVisibility();
    const isAtBottom = !chatterContainer || chatterContainer.style.display === 'none';
    updateButtonIcon(isAtBottom);
    if (!isAtBottom) {
      createResizeHandle();
      if (resizeHandle) resizeHandle.style.display = '';
    } else if (resizeHandle) {
      resizeHandle.style.display = 'none';
    }
    return isAtBottom;
  }

  function toggleChatterPosition(savePosition = false) {
    const oContentElement = document.querySelector('.o_content'),
          chatterContainer = document.querySelector('.o-mail-ChatterContainer.o-mail-Form-chatter'),
          mailChatter = document.querySelector('.o-mail-Chatter'),
          formSheetBgElement = document.querySelector('.o_form_sheet_bg'),
          formViewElement = document.querySelector('.o_form_view'),
          titleElement = document.querySelector('.oe_title'); // Başlık divini seçiyoruz

    isAccountMovePage = isAccountMoveWithAttachment();
    const attachmentPreview = document.querySelector('.o_attachment_preview');

    if (!oContentElement || !mailChatter) return;

    const styleElement = document.getElementById('chatter-override-style'),
          isAtBottom = checkChatterPosition();

    if (!isAtBottom) {
        if (chatterContainer) {
            lastChatterWidth = chatterContainer.offsetWidth;
            localStorage.setItem(STORAGE_WIDTH_KEY, lastChatterWidth);
        }
        originalParent = mailChatter.parentElement;
        originalNextSibling = mailChatter.nextSibling;
        oContentElement.appendChild(mailChatter);
        if (chatterContainer) chatterContainer.style.display = 'none';
        if (formSheetBgElement) formSheetBgElement.style.maxWidth = '';
        if (titleElement) titleElement.style.maxWidth = '90%'; // Chatter alta taşındığında %90 yap

        // Tedarikçi Faturaları ekranı ve PDF görüntüleyici için özel işlem
        if (isAccountMovePage && attachmentPreview) {
            originalAttachmentPreview = attachmentPreview.parentElement;
            attachmentPreview.style.display = 'none';
        }

        if (!styleElement) {
            const style = document.createElement('style');
            style.id = 'chatter-override-style';
            style.textContent = `
                .o_form_view .o_form_sheet_bg { max-width: none !important; }
                .o_form_view .o_form_renderer { max-width: none !important; }
            `;
            document.head.appendChild(style);
        }
        document.querySelectorAll('.h-100 div').forEach(div => div.classList.remove('h-100'));
    } else {
        if (originalParent && mailChatter) {
            if (originalNextSibling) {
                originalParent.insertBefore(mailChatter, originalNextSibling);
            } else {
                originalParent.appendChild(mailChatter);
            }
            if (chatterContainer) {
                chatterContainer.style.display = '';
                const savedWidth = parseInt(localStorage.getItem(STORAGE_WIDTH_KEY));
                const widthToUse = savedWidth || (hasBeenResized ? lastChatterWidth : (initialChatterWidth || DEFAULT_CHATTER_WIDTH));
                chatterContainer.style.width = `${widthToUse}px`;
            }
            if (formSheetBgElement && formViewElement) {
                const savedWidth = parseInt(localStorage.getItem(STORAGE_WIDTH_KEY));
                const widthToUse = savedWidth || (hasBeenResized ? lastChatterWidth : (initialChatterWidth || DEFAULT_CHATTER_WIDTH));
                formSheetBgElement.style.maxWidth = `${formViewElement.offsetWidth - widthToUse}px`;
            }
            if (titleElement) titleElement.style.maxWidth = '75%'; // Chatter eski yerine geldiğinde %75 yap

            // Tedarikçi Faturaları ekranı için PDF görüntüleyiciyi geri getir
            const attachmentPreview = document.querySelector('.o_attachment_preview');
            if (isAccountMovePage && attachmentPreview && attachmentPreview.style.display === 'none') {
                attachmentPreview.style.display = '';
            }

            if (styleElement) styleElement.remove();
            formViewElement.querySelectorAll('div').forEach(div => {
                if (div.classList.contains('o_form_sheet_bg') || div.classList.contains('o_form_sheet')) {
                    div.classList.add('h-100');
                }
            });
            setTimeout(createResizeHandle, 100);
        }
    }

    if (savePosition) saveChatterPosition(!isAtBottom);
    updateButtonIcon(!isAtBottom);
  }

  function applyChatterPosition() {
    const position = getChatterPosition(),
          currentPosition = checkChatterPosition();
    if ((position === 'bottom' && !currentPosition) || (position === 'side' && currentPosition)) {
      toggleChatterPosition(false);
    }
  }

  function initializeScript() {
    if (initializationAttempts >= MAX_INITIALIZATION_ATTEMPTS) {
      console.log('Maximum initialization attempts reached');
      return;
    }
    const mailChatter = document.querySelector('.o-mail-Chatter'),
          menuSystray = document.querySelector('.o_menu_systray');
    if (!mailChatter || !menuSystray) {
      initializationAttempts++;
      setTimeout(initializeScript, 500);
      return;
    }
    saveInitialState();
    if (addControlButton()) {
      if (!checkChatterPosition()) {
        createResizeHandle();
      }
      applyChatterPosition();
      initializationAttempts = 0;
    }
  }

  window.addEventListener('load', initializeScript);

  let lastUrl = location.href;
  const observer = new MutationObserver(mutations => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      initializationAttempts = 0;
      setTimeout(() => {
        initializeScript();
        updateButtonVisibility();
      }, 500);
    } else {
      const hasRelevantChanges = mutations.some(mutation => {
        return Array.from(mutation.addedNodes).some(node =>
          node.nodeType === Node.ELEMENT_NODE && (node.classList?.contains('o-mail-Chatter') || node.querySelector?.('.o-mail-Chatter') ||
          node.classList?.contains('o_attachment_preview') || node.querySelector?.('.o_attachment_preview'))
        ) || Array.from(mutation.removedNodes).some(node =>
          node.nodeType === Node.ELEMENT_NODE && (node.classList?.contains('o-mail-Chatter') || node.querySelector?.('.o-mail-Chatter') ||
          node.classList?.contains('o_attachment_preview') || node.querySelector?.('.o_attachment_preview'))
        );
      });
      if (hasRelevantChanges) {
        initializationAttempts = 0;
        setTimeout(() => {
          initializeScript();
          updateButtonVisibility();
        }, 500);
      }
    }
  });

  observer.observe(document, { subtree: true, childList: true });
})();