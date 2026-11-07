/**
 * drop-zone.js
 * 通用拖拽上传与剪贴板 Ctrl+V 粘贴组件
 * 专为小蛇和小奚的恋爱记录定制：提供粉色浪漫高亮、玻璃拟态提示蒙层与防闪烁拖拽体验
 */
(function(window) {
    'use strict';

    // 1. 全局防止浏览器默认的拖放导航（避免意外拖出区域导致页面被浏览器替换导航）
    ['dragover', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            // 只要是在全局未被专门处理的拖放，都防止浏览器默认打开文件
            e.preventDefault();
        }, false);
    });

    /**
     * 判断文件是否匹配 accept 规范（如 'image/*,video/*' 或 'image/*' 或 '.png,.jpg'）
     * @param {File} file
     * @param {string} accept
     * @returns {boolean}
     */
    function isFileAccepted(file, accept) {
        if (!file) return false;
        if (!accept || accept.trim() === '' || accept.trim() === '*/*') return true;

        const rules = accept.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
        const fileType = (file.type || '').toLowerCase();
        const fileName = (file.name || '').toLowerCase();

        return rules.some(rule => {
            if (rule === '*/*') return true;
            if (rule.endsWith('/*')) {
                const prefix = rule.slice(0, -1); // e.g. 'image/'
                if (fileType.startsWith(prefix)) return true;
                // 某些剪贴板粘贴的图片没有 type，尝试根据文件名后缀判断
                if (prefix === 'image/' && /\.(jpe?g|png|webp|gif|bmp|heic|svg)$/i.test(fileName)) {
                    return true;
                }
                if (prefix === 'video/' && /\.(mp4|webm|mov|m4v|mkv)$/i.test(fileName)) {
                    return true;
                }
                return false;
            }
            if (rule.startsWith('.')) {
                return fileName.endsWith(rule);
            }
            if (rule.includes('/')) {
                return fileType === rule;
            }
            return false;
        });
    }

    /**
     * 判断拖拽事件中是否包含文件
     * @param {DragEvent} e
     * @returns {boolean}
     */
    function hasDragFiles(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        const types = e.dataTransfer.types;
        if (Array.isArray(types)) {
            return types.includes('Files');
        }
        if (typeof types.contains === 'function') {
            return types.contains('Files');
        }
        if (typeof types.indexOf === 'function') {
            return types.indexOf('Files') !== -1;
        }
        return false;
    }

    /**
     * 注册拖拽与剪贴板粘贴区域
     * @param {Object} options
     * @param {HTMLElement|string} options.target 目标元素或 CSS 选择器
     * @param {(files: File[]) => void} options.onFiles 文件接收回调
     * @param {string} [options.accept='image/*'] 允许的文件类型
     * @param {string} [options.promptText='松开即可添加文件 🌸'] 拖拽悬停提示文案
     * @param {string} [options.promptIcon='📸'] 提示图标
     * @param {boolean} [options.enablePaste=true] 是否启用剪贴板粘贴
     * @param {() => boolean} [options.isEnabled] 动态可用性检查
     * @returns {{ unbind: () => void, destroy: () => void }} 清理函数
     */
    function registerDropAndPasteZone(options) {
        if (!options) return { unbind: () => {}, destroy: () => {} };

        let targetEl = options.target;
        if (typeof targetEl === 'string') {
            targetEl = document.querySelector(targetEl);
        }
        if (!targetEl || !(targetEl instanceof HTMLElement)) {
            return { unbind: () => {}, destroy: () => {} };
        }

        const accept = options.accept || 'image/*';
        const promptText = options.promptText || '松开即可添加文件 🌸';
        const promptIcon = options.promptIcon || '📸';
        const enablePaste = options.enablePaste !== false;
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
        const onFiles = typeof options.onFiles === 'function' ? options.onFiles : () => {};

        // 避免重复注册
        if (targetEl._dropZoneInstance) {
            targetEl._dropZoneInstance.unbind();
        }

        let dragCounter = 0;
        targetEl.classList.add('has-drop-zone');

        // 创建蒙层 DOM
        const overlayEl = document.createElement('div');
        overlayEl.className = 'drop-zone-overlay';
        overlayEl.setAttribute('aria-hidden', 'true');
        overlayEl.innerHTML = `
            <div class="drop-zone-modal-box">
                <span class="drop-zone-icon">${promptIcon}</span>
                <span class="drop-zone-text">${promptText}</span>
            </div>
        `;
        targetEl.appendChild(overlayEl);

        const showOverlay = () => {
            targetEl.classList.add('is-drag-over');
            overlayEl.classList.add('is-active');
        };

        const hideOverlay = () => {
            targetEl.classList.remove('is-drag-over');
            overlayEl.classList.remove('is-active');
        };

        // 拖拽事件监听
        const handleDragEnter = (e) => {
            if (!isEnabled()) return;
            if (!hasDragFiles(e)) return;

            e.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                showOverlay();
            }
        };

        const handleDragOver = (e) => {
            if (!isEnabled()) return;
            if (!hasDragFiles(e)) return;

            e.preventDefault();
            try {
                e.dataTransfer.dropEffect = 'copy';
            } catch (_e) {}
        };

        const handleDragLeave = (e) => {
            if (!isEnabled()) return;
            if (!hasDragFiles(e)) return;

            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                hideOverlay();
            }
        };

        const handleDrop = (e) => {
            if (!isEnabled() || !hasDragFiles(e)) {
                dragCounter = 0;
                hideOverlay();
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            hideOverlay();

            const rawFiles = Array.from(e.dataTransfer.files || []);
            if (!rawFiles.length) return;

            const validFiles = rawFiles.filter(file => isFileAccepted(file, accept));
            if (validFiles.length > 0) {
                onFiles(validFiles);
            }
        };

        // 剪贴板粘贴监听
        const handlePaste = (e) => {
            if (!enablePaste || !isEnabled()) return;
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;

            const items = Array.from(clipboardData.items || []);
            const fileList = [];

            for (const item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) fileList.push(file);
                }
            }

            if (!fileList.length && clipboardData.files && clipboardData.files.length) {
                fileList.push(...Array.from(clipboardData.files));
            }

            const validFiles = fileList.filter(file => isFileAccepted(file, accept));
            if (validFiles.length > 0) {
                // 仅当剪贴板中检测到符合条件的文件时拦截并消费，保证不阻碍纯文本正常输入
                e.preventDefault();
                e.stopPropagation();
                onFiles(validFiles);
            }
        };

        targetEl.addEventListener('dragenter', handleDragEnter, false);
        targetEl.addEventListener('dragover', handleDragOver, false);
        targetEl.addEventListener('dragleave', handleDragLeave, false);
        targetEl.addEventListener('drop', handleDrop, false);
        if (enablePaste) {
            targetEl.addEventListener('paste', handlePaste, false);
        }

        const unbind = () => {
            targetEl.removeEventListener('dragenter', handleDragEnter, false);
            targetEl.removeEventListener('dragover', handleDragOver, false);
            targetEl.removeEventListener('dragleave', handleDragLeave, false);
            targetEl.removeEventListener('drop', handleDrop, false);
            if (enablePaste) {
                targetEl.removeEventListener('paste', handlePaste, false);
            }
            hideOverlay();
            if (overlayEl && overlayEl.parentNode === targetEl) {
                targetEl.removeChild(overlayEl);
            }
            targetEl.classList.remove('has-drop-zone', 'is-drag-over');
            delete targetEl._dropZoneInstance;
        };

        const instance = { unbind, destroy: unbind };
        targetEl._dropZoneInstance = instance;
        return instance;
    }

    window.registerDropAndPasteZone = registerDropAndPasteZone;
})(window);
