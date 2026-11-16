import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDragDrop } from '../src/drag-drop.mjs';

// Minimal boundary fixture: attributes, ancestry, delegated events and observer flush.
class Element {
    constructor(document) {
        this.ownerDocument = document; this.nodeType = 1; this.parentElement = null;
        this.children = []; this.attrs = new Map(); this.listeners = new Map();
    }
    get isConnected() { return this === this.ownerDocument || !!this.parentElement?.isConnected; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    removeAttribute(k) { this.attrs.delete(k); }
    contains(node) { return !!node && (node === this || this.children.some(c => c.contains(node))); }
    append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
    remove() {
        if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
    }
    matches(selector) {
        if (selector === '[data-item]') return this.attrs.has('data-item');
        if (selector === '[data-drag-ghost="true"]') return this.getAttribute('data-drag-ghost') === 'true';
        throw Error(`Unexpected selector ${selector}`);
    }
    closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) ?? null; }
    querySelectorAll(s) { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]); }
    getBoundingClientRect() { return { left: 10, right: 110, top: 50, bottom: 60 }; }
    addEventListener(k, f) { this.listeners.set(k, [...(this.listeners.get(k) ?? []), f]); }
    removeEventListener(k, f) { this.listeners.set(k, this.listeners.get(k).filter(v => v !== f)); }
    emit(k, details = {}) {
        const event = { target: this, clientX: 500, clientY: 500, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }, ...details };
        for (const f of this.listeners.get(k) ?? []) event.result = f(event);
        return event;
    }
}
function fixture(overrides = {}) {
    const observers = [];
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    }
    const document = new Element(null); document.ownerDocument = document;
    document.defaultView = { MutationObserver: Observer };
    const root = new Element(document); document.append(root);
    const items = ['a', 'b', 'c'].map(id => {
        const item = new Element(document); item.setAttribute('data-item', id); item.setAttribute('draggable', 'true'); root.append(item); return item;
    });
    items[0].setAttribute('aria-grabbed', 'false');
    let ghost;
    const drops = [];
    const options = {
        itemSelector: '[data-item]', getId: item => item.getAttribute('data-item'),
        getPlacement: () => 'before', canDrop: () => true,
        createGhost() { ghost = new Element(document); return ghost; },
        placeGhost: ({ ghost }) => root.append(ghost),
        onDrop(result) {
            assert.equal(ghost.isConnected, false);
            assert.equal(items[0].getAttribute('aria-grabbed'), 'false'); drops.push(result);
        }, ...overrides,
    };
    const controller = bindDragDrop(root, options);
    return { root, document, items, options, controller, drops, get ghost() { return ghost; },
        emit: (name, target = items[0], details = {}) => root.emit(name, { target, ...details }),
        flush() { for (const o of observers) if (o.active) o.callback(); } };
}

test('delegated drag, ghost hit and 4px fringe retain exact promise; cleanup precedes drop', () => {
    let placement = 'before'; const f = fixture({ getPlacement: () => placement });
    assert.ok(f.items.every(i => i.getAttribute('draggable') === 'true'));
    const child = new Element(f.document); f.items[0].append(child);
    const data = [];
    f.emit('dragstart', child, { dataTransfer: { setData: (...args) => data.push(args) } });
    assert.deepEqual(data, [['text/plain', 'a']]);
    assert.equal(f.items[0].getAttribute('aria-grabbed'), 'true');
    assert.equal(f.emit('dragover', f.items[1]).defaultPrevented, true);
    const ghost = f.ghost; placement = 'after';
    assert.equal(f.emit('dragover', ghost).defaultPrevented, true);
    assert.equal(f.emit('dragover', f.root, { clientX: 9, clientY: 48 }).defaultPrevented, true);
    assert.equal(f.ghost, ghost); assert.deepEqual(f.root.children.slice(0, 3), f.items);
    assert.equal(ghost.getAttribute('data-drag-ghost'), 'true');
    assert.equal(f.emit('drop', ghost).defaultPrevented, true);
    assert.deepEqual(f.drops, [{ sourceId: 'a', targetId: 'b', placement: 'before' }]);
    f.emit('drop', f.items[1]); assert.equal(f.drops.length, 1);
    f.controller.destroy();
    assert.equal(f.items[0].getAttribute('draggable'), 'true');
    assert.equal(f.items[1].getAttribute('draggable'), 'true');
});

test('external drags ignored; invalid target clears ghost without preventing default', () => {
    const f = fixture({ canDrop: ({ targetId }) => targetId !== 'c' });
    assert.equal(f.emit('dragover', f.items[1]).defaultPrevented, false);
    assert.equal(f.emit('drop', f.items[1]).defaultPrevented, false);
    f.emit('dragstart'); f.emit('dragover', f.items[1]); const ghost = f.ghost;
    assert.equal(f.emit('dragover', f.items[2]).defaultPrevented, false);
    assert.equal(ghost.isConnected, false);
    assert.equal(f.emit('drop', f.items[2]).defaultPrevented, false);
    assert.deepEqual(f.drops, []); f.controller.destroy();
});

test('drop does not substitute target or ignore changed rules or identity', () => {
    for (const change of ['target', 'rule', 'identity']) {
        let valid = true; const f = fixture({ canDrop: () => valid });
        f.emit('dragstart'); f.emit('dragover', f.items[1]);
        if (change === 'rule') valid = false;
        if (change === 'identity') f.items[1].setAttribute('data-item', 'replacement');
        assert.equal(f.emit('drop', f.items[change === 'target' ? 2 : 1]).defaultPrevented, false);
        assert.deepEqual(f.drops, []); assert.equal(f.ghost.isConnected, false); f.controller.destroy();
    }
});

test('native termination, explicit cancel/destroy and disconnection clean up', () => {
    for (const end of [f => f.controller.cancel(), f => f.document.emit('keydown', { key: 'Escape' }),
        f => f.document.emit('dragend'), f => f.emit('dragleave', f.items[1], { relatedTarget: null }),
        f => f.document.emit('drop'), f => { f.items[0].remove(); f.flush(); },
        f => { f.items[1].remove(); f.flush(); }, f => { f.root.remove(); f.flush(); }, f => f.controller.destroy()]) {
        const f = fixture(); f.emit('dragstart'); f.emit('dragover', f.items[1]); end(f);
        assert.equal(f.ghost.isConnected, false); assert.equal(f.items[0].getAttribute('aria-grabbed'), 'false');
        assert.equal(f.emit('drop', f.items[1]).defaultPrevented, false); assert.deepEqual(f.drops, []);
        f.controller.destroy(); f.controller.destroy();
    }
});

test('internal/null-related leave within root keeps drag; caller attributes remain untouched', () => {
    const f = fixture(); f.emit('dragstart'); f.emit('dragover', f.items[1]);
    f.emit('dragleave', f.items[1], { relatedTarget: f.ghost });
    assert.equal(f.items[0].getAttribute('aria-grabbed'), 'true');
    const next = new Element(f.document); next.setAttribute('data-item', 'new'); f.root.append(next); f.flush();
    assert.equal(next.getAttribute('draggable'), null); assert.equal(next.listeners.size, 0);
    f.emit('dragleave', f.items[1], { relatedTarget: null, clientX: 20, clientY: 55 });
    assert.equal(f.items[0].getAttribute('aria-grabbed'), 'true');
    f.controller.destroy(); assert.equal(next.getAttribute('draggable'), null);
    assert.ok([...f.root.listeners.values(), ...f.document.listeners.values()].every(v => v.length === 0));
});

test('onDrop promise returned and synchronous errors not swallowed, after cleanup', async () => {
    const result = Promise.resolve('saved');
    const f = fixture({ onDrop: () => { assert.equal(f.ghost.isConnected, false); return result; } });
    f.emit('dragstart'); f.emit('dragover', f.items[1]);
    assert.equal(f.emit('drop', f.ghost).result, result); assert.equal(await result, 'saved'); f.controller.destroy();
    const error = Error('caller failure'); const g = fixture({ onDrop: () => { throw error; } });
    g.emit('dragstart'); g.emit('dragover', g.items[1]); assert.throws(() => g.emit('drop', g.ghost), error);
    assert.equal(g.ghost.isConnected, false); assert.equal(g.items[0].getAttribute('aria-grabbed'), 'false'); g.controller.destroy();
});

test('all callbacks required', () => {
    const f = fixture(); f.controller.destroy();
    for (const name of ['getId', 'getPlacement', 'canDrop', 'createGhost', 'placeGhost', 'onDrop']) {
        assert.throws(() => bindDragDrop(f.root, { ...f.options, [name]: undefined }), TypeError);
    }
});

test('all placements are caller-owned; null/self/empty targets reject without native acceptance', () => {
    for (const placement of ['before', 'after', 'inside']) {
        const f = fixture({ getPlacement: () => placement });
        f.emit('dragstart'); f.emit('dragover', f.items[1]); f.emit('drop', f.items[1]);
        assert.deepEqual(f.drops, [{ sourceId: 'a', targetId: 'b', placement }]); f.controller.destroy();
    }
    const f = fixture({ getPlacement: () => null }); f.emit('dragstart');
    for (const target of [f.items[0], f.items[1], f.root]) {
        assert.equal(f.emit('dragover', target).defaultPrevented, false);
    }
    assert.equal(f.ghost, undefined); f.controller.destroy();
});

test('source and neighboring-row hits within ghost fringe preserve promised target', () => {
    const f = fixture(); f.emit('dragstart'); f.emit('dragover', f.items[1]);
    for (const target of [f.items[0], f.items[2], f.ghost]) {
        assert.equal(f.emit('dragover', target, { clientX: 10, clientY: 63 }).defaultPrevented, true);
    }
    f.emit('drop', f.items[0], { clientX: 10, clientY: 63 });
    assert.deepEqual(f.drops, [{ sourceId: 'a', targetId: 'b', placement: 'before' }]); f.controller.destroy();
});

test('native start requires caller draggable=true and rejects disabled and ghost items', () => {
    for (const change of [item => item.removeAttribute('draggable'),
        item => item.setAttribute('draggable', 'false'), item => { item.disabled = true; },
        item => item.setAttribute('aria-disabled', 'true'), item => item.setAttribute('data-drag-ghost', 'true')]) {
        const f = fixture(); change(f.items[0]);
        assert.equal(f.emit('dragstart').defaultPrevented, true);
        assert.equal(f.items[0].getAttribute('aria-grabbed'), 'false');
        assert.equal(f.emit('dragover', f.items[1]).defaultPrevented, false); f.controller.destroy();
    }
});
