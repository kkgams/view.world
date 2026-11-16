// Callers own geometry, domain rules, keyboard alternatives and callback errors.
export function bindDragDrop(root, options) {
    const { itemSelector, getId, getPlacement, canDrop, createGhost, placeGhost, onDrop } = options;
    if (typeof itemSelector !== 'string' || !itemSelector) throw new TypeError('itemSelector is required');
    for (const callback of [getId, getPlacement, canDrop, createGhost, placeGhost, onDrop]) {
        if (typeof callback !== 'function') throw new TypeError('All drag/drop callbacks are required');
    }
    const document = root.ownerDocument;
    const Observer = document.defaultView.MutationObserver;
    let source = null;
    let sourceId;
    let grabbed;
    let promise = null;
    let destroyed = false;

    function restore(element, name, value) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }
    function clearPromise() {
        if (promise) promise.ghost.remove();
        promise = null;
    }
    function cancel() {
        clearPromise();
        if (source) restore(source, 'aria-grabbed', grabbed);
        source = null;
        sourceId = undefined;
        disconnectObserver.disconnect();
    }
    function alive() {
        if (!source) return false;
        if (!root.isConnected || !root.contains(source) ||
            (promise && (!root.contains(promise.target) || !root.contains(promise.ghost)))) {
            cancel();
            return false;
        }
        return true;
    }
    function itemAt(node) {
        const element = node && (node.nodeType === 1 ? node : node.parentElement);
        const item = element && element.closest(itemSelector);
        return item && item !== root && root.contains(item) ? item : null;
    }
    function hitsPromise(event) {
        if (!promise) return false;
        if (promise.ghost.contains(event.target)) return true;
        const rect = promise.ghost.getBoundingClientRect();
        return event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 &&
            event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
    }
    function allowed() {
        return getId(source) === sourceId && getId(promise.target) === promise.targetId &&
            canDrop({ sourceId, targetId: promise.targetId, placement: promise.placement });
    }
    function dragstart(event) {
        cancel();
        const item = itemAt(event.target);
        if (!item) return;
        if (item.getAttribute('draggable') !== 'true' || item.disabled ||
            item.getAttribute('aria-disabled') === 'true' || item.closest('[data-drag-ghost="true"]')) {
            event.preventDefault();
            return;
        }
        sourceId = getId(item);
        source = item;
        grabbed = item.getAttribute('aria-grabbed');
        item.setAttribute('aria-grabbed', 'true');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // Firefox requires data; transfer contents never establish local state.
            event.dataTransfer.setData('text/plain', String(sourceId));
        }
        disconnectObserver.observe(document, { childList: true, subtree: true });
    }
    function dragover(event) {
        if (!alive()) return;
        if (hitsPromise(event)) {
            if (allowed()) event.preventDefault();
            else clearPromise();
            return;
        }
        const target = itemAt(event.target);
        if (!target || target === source) {
            clearPromise();
            return;
        }
        const placement = getPlacement({ source, target, event });
        if (placement !== null && !['before', 'after', 'inside'].includes(placement)) {
            clearPromise();
            throw new TypeError('Invalid drag/drop placement');
        }
        const targetId = getId(target);
        if (placement === null || !canDrop({ sourceId, targetId, placement })) {
            clearPromise();
            return;
        }
        if (!promise || promise.target !== target || promise.placement !== placement) {
            clearPromise();
            const ghost = createGhost({ source, target, placement });
            if (!ghost || ghost.nodeType !== 1 || ghost.isConnected || ghost === source || ghost === target) {
                throw new TypeError('createGhost must return a detached Element');
            }
            ghost.setAttribute('data-drag-ghost', 'true');
            ghost.setAttribute('draggable', 'false');
            promise = { ghost, target, targetId, placement };
            placeGhost({ ghost, target, placement });
        }
        event.preventDefault();
    }
    function drop(event) {
        if (!alive()) return;
        if (!promise || (!hitsPromise(event) && itemAt(event.target) !== promise.target) || !allowed()) {
            cancel();
            return;
        }
        const result = { sourceId, targetId: promise.targetId, placement: promise.placement };
        event.preventDefault();
        cancel();
        return onDrop(result);
    }
    function dragleave(event) {
        if (root.contains(event.relatedTarget)) return;
        const rect = root.getBoundingClientRect();
        if (event.clientX < rect.left - 4 || event.clientX > rect.right + 4 ||
            event.clientY < rect.top - 4 || event.clientY > rect.bottom + 4) cancel();
    }
    function outsideDrop(event) {
        if (!root.contains(event.target)) cancel();
    }
    function keydown(event) {
        if (event.key === 'Escape') cancel();
    }
    const disconnectObserver = new Observer(() => alive());
    const rootEvents = { dragstart, dragover, drop, dragleave };
    for (const [name, handler] of Object.entries(rootEvents)) root.addEventListener(name, handler);
    document.addEventListener('drop', outsideDrop, true);
    document.addEventListener('dragend', cancel, true);
    document.addEventListener('keydown', keydown, true);
    return {
        cancel,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            cancel();
            for (const [name, handler] of Object.entries(rootEvents)) root.removeEventListener(name, handler);
            document.removeEventListener('drop', outsideDrop, true);
            document.removeEventListener('dragend', cancel, true);
            document.removeEventListener('keydown', keydown, true);
        },
    };
}
