// Tiny synchronous event bus so systems can talk without importing each other.
// Usage: events.on('stalker:chase', fn); events.emit('stalker:chase', payload);

class EventBus {
  constructor() {
    this._map = new Map();
  }

  on(type, handler) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const wrap = (payload) => {
      this.off(type, wrap);
      handler(payload);
    };
    return this.on(type, wrap);
  }

  off(type, handler) {
    const set = this._map.get(type);
    if (set) set.delete(handler);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    // Copy so handlers can safely unsubscribe during dispatch.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear() {
    this._map.clear();
  }
}

// Shared singleton.
export const events = new EventBus();

// Canonical event names (documentation + typo insurance).
export const EVT = {
  STATE_CHANGE: 'game:state', // { state, prev }
  NOISE: 'noise', // { position: {x,z}, zone, radius }
  PLAYER_CAUGHT: 'player:caught',
  EXIT_POWERED: 'exit:powered',
  PLAYER_ESCAPED: 'player:escaped',
  STALKER_STATE: 'stalker:state', // { state, distance }
  STALKER_CHASE_START: 'stalker:chaseStart',
  FLASHLIGHT_TOGGLE: 'flashlight:toggle', // { on }
  BATTERY_PICKUP: 'battery:pickup',
  SHIFT: 'world:shift', // { blackout }
  HIDE_ENTER: 'hide:enter',
  HIDE_EXIT: 'hide:exit',
  PICKUP_CHIME: 'audio:pickup',
  DOOR_CHIME: 'audio:door',
  SUBTITLE: 'ui:subtitle', // { text, ms }
  LEVEL_START: 'level:start', // { day }
  ZONE_CHANGE: 'zone:change', // { zone } — player stepped through a portal
  TASK_PROGRESS: 'task:progress', // { text } — generic task counter update
  DIGIT: 'input:digit', // { n } — 0-9 pressed (top row)
  KEYPAD_OPEN: 'keypad:open', // { open, entry, length }
  KEYPAD_FAIL: 'keypad:fail',
  SCARE: 'scare', // { kind } — mini-scare fired
};
