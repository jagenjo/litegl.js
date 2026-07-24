// LEvent: a lightweight events library focused on low memory footprint and fast delivery.
//
// It works by creating a non-enumerable property called "__levents" inside the object that holds the
// bindings, storing arrays with all the bindings. Each binding is a tuple of [callback, target].
//
// Ported from levent.js. Pure ESM: exports `LEvent` with the original name; a later index.ts
// re-attaches it to the GL namespace + window.

/** A bound event handler. Receives arbitrary arguments and may return `true` to stop propagation. */
export type LEventCallback = (...args: unknown[]) => unknown;

/** One stored binding: the callback plus the target instance it is applied to (its `this`). */
export type LEventBinding = [LEventCallback, unknown];

/**
 * Any object LEvent operates on. The hidden `__levents` map (event name -> array of bindings) is
 * injected via Object.defineProperty. The optional `onLEvent*` hooks, when present, are notified.
 */
export interface LEventTarget {
  __levents?: Record<string, LEventBinding[]>;
  onLEventBinded?(event_type: string, callback: LEventCallback, target_instance: unknown): void;
  onLEventUnbinded?(event_type: string, callback: LEventCallback, target_instance: unknown): void;
  onLEventUnbindAll?(...args: unknown[]): void;
}

export const LEvent = {
  /**
   * Binds an event to an instance
   * @method LEvent.bind
   * @param {Object} instance where to attach the event
   * @param {String} event_name string defining the event name
   * @param {function} callback function to call when the event is triggered
   * @param {Object} target_instance [Optional] instance to call the function (use this instead of .bind method to help removing events)
   **/
  bind(instance: object, event_type: string, callback: LEventCallback, target_instance?: unknown): void {
    if (!instance)
      throw "cannot bind event to null";
    if (!callback)
      throw "cannot bind to null callback";
    if (instance.constructor === String)
      throw "cannot bind event to a string";

    const target = instance as LEventTarget;
    let events = target.__levents;
    if (!events) {
      Object.defineProperty(target, "__levents", { value: {}, enumerable: false });
      events = target.__levents as Record<string, LEventBinding[]>;
    }

    if (Object.prototype.hasOwnProperty.call(events, event_type))
      events[event_type].push([callback, target_instance]);
    else
      events[event_type] = [[callback, target_instance]];
    if (target.onLEventBinded)
      target.onLEventBinded(event_type, callback, target_instance);
  },

  /**
   * Unbinds an event from an instance
   * @method LEvent.unbind
   * @param {Object} instance where the event is binded
   * @param {String} event_name string defining the event name
   * @param {function} callback function that was binded
   * @param {Object} target_instance [Optional] target_instance that was binded
   **/
  unbind(instance: object, event_type: string, callback: LEventCallback, target_instance?: unknown): void {
    if (!instance)
      throw "cannot unbind event to null";
    if (!callback)
      throw "cannot unbind from null callback";
    if (instance.constructor === String)
      throw "cannot bind event to a string";

    const target = instance as LEventTarget;
    const events = target.__levents;
    if (!events)
      return;

    if (!Object.prototype.hasOwnProperty.call(events, event_type))
      return;

    for (let i = 0, l = events[event_type].length; i < l; ++i) {
      const v = events[event_type][i];
      if (v[0] === callback && v[1] === target_instance) {
        events[event_type].splice(i, 1);
        break;
      }
    }

    if (events[event_type].length == 0)
      delete events[event_type];

    if (target.onLEventUnbinded)
      target.onLEventUnbinded(event_type, callback, target_instance);
  },

  /**
   * Unbinds all events from an instance (or the ones that match certain target_instance)
   * @method LEvent.unbindAll
   * @param {Object} instance where the events are binded
   * @param {Object} target_instance [Optional] target_instance of the events to remove
   **/
  unbindAll(instance: object, target_instance?: unknown, callback?: LEventCallback): void {
    if (!instance)
      throw "cannot unbind events in null";

    const target = instance as LEventTarget;
    const events = target.__levents;
    if (!events)
      return;

    if (target.onLEventUnbindAll)
      target.onLEventUnbindAll(target_instance, callback);

    if (!target_instance) { //remove all
      delete target.__levents;
      return;
    }

    //remove only the target_instance
    //for every property in the instance
    for (const i in events) {
      const array = events[i];
      for (let j = array.length - 1; j >= 0; --j) { //iterate backwards to avoid problems after removing
        if (array[j][1] != target_instance || (callback && callback !== array[j][0]))
          continue;

        array.splice(j, 1); //remove
      }
    }
  },

  /**
   * Unbinds all callbacks associated to one specific event from this instance
   * @method LEvent.unbindAllEvent
   * @param {Object} instance where the events are binded
   * @param {String} event name of the event you want to remove all binds
   **/
  unbindAllEvent(instance: object, event_type: string): void {
    if (!instance)
      throw "cannot unbind events in null";

    const target = instance as LEventTarget;
    const events = target.__levents;
    if (!events)
      return;
    delete events[event_type];
    if (target.onLEventUnbindAll)
      target.onLEventUnbindAll(event_type, undefined, undefined);
    return;
  },

  /**
   * Tells if there is a binded callback that matches the criteria
   * @method LEvent.isBind
   * @param {Object} instance where the are the events binded
   * @param {String} event_name string defining the event name
   * @param {function} callback the callback
   * @param {Object} target_instance [Optional] instance binded to callback
   **/
  isBind(instance: object, event_type: string, callback: LEventCallback, target_instance?: unknown): boolean | undefined {
    if (!instance)
      throw "LEvent cannot have null as instance";

    const events = (instance as LEventTarget).__levents;
    if (!events)
      return;

    if (!Object.prototype.hasOwnProperty.call(events, event_type))
      return false;

    for (let i = 0, l = events[event_type].length; i < l; ++i) {
      const v = events[event_type][i];
      if (v[0] === callback && v[1] === target_instance)
        return true;
    }
    return false;
  },

  /**
   * Tells if there is any callback binded to this event
   * @method LEvent.hasBind
   * @param {Object} instance where the are the events binded
   * @param {String} event_name string defining the event name
   * @return {boolean} true is there is at least one
   **/
  hasBind(instance: object, event_type: string): boolean {
    if (!instance)
      throw "LEvent cannot have null as instance";
    const events = (instance as LEventTarget).__levents;
    if (!events || !Object.prototype.hasOwnProperty.call(events, event_type) || !events[event_type].length)
      return false;
    return true;
  },

  /**
   * Tells if there is any callback binded to this object pointing to a method in the target object
   * @method LEvent.hasBindTo
   * @param {Object} instance where there are the events binded
   * @param {Object} target instance to check to
   * @return {boolean} true is there is at least one
   **/
  hasBindTo(instance: object, target: unknown): boolean {
    if (!instance)
      throw "LEvent cannot have null as instance";
    const events = (instance as LEventTarget).__levents;

    //no events binded
    if (!events)
      return false;

    for (const j in events) {
      const binds = events[j];
      for (let i = 0; i < binds.length; ++i) {
        if (binds[i][1] === target) //one found
          return true;
      }
    }

    return false;
  },

  /**
   * Triggers and event in an instance
   * If the callback returns true then it will stop the propagation and return true
   * @method LEvent.trigger
   * @param {Object} instance that triggers the event
   * @param {String} event_name string defining the event name
   * @param {*} parameters that will be received by the binded function
   * @param {bool} reverse_order trigger in reverse order (binded last get called first)
   * @param {bool} expand_parameters parameters are passed not as one single parameter, but as many
   * return {bool} true if the event passed was blocked by any binded callback
   **/
  trigger(instance: object, event_type: string, params?: unknown, reverse_order?: boolean, expand_parameters?: boolean): boolean {
    if (!instance)
      throw "cannot trigger event from null";
    if (instance.constructor === String)
      throw "cannot bind event to a string";

    const events = (instance as LEventTarget).__levents;
    if (!events || !Object.prototype.hasOwnProperty.call(events, event_type))
      return false;

    const inst = events[event_type];
    if (reverse_order) {
      for (let i = inst.length - 1; i >= 0; --i) {
        const v = inst[i];
        if (expand_parameters) {
          if (v && v[0].apply(v[1], params as unknown[]) === true) // || event.stop)
            return true; //stopPropagation
        } else {
          if (v && v[0].call(v[1], event_type, params) === true) // || event.stop)
            return true; //stopPropagation
        }
      }
    } else {
      for (let i = 0, l = inst.length; i < l; ++i) {
        const v = inst[i];
        if (expand_parameters) {
          if (v && v[0].apply(v[1], params as unknown[]) === true) // || event.stop)
            return true; //stopPropagation
        } else {
          if (v && v[0].call(v[1], event_type, params) === true) // || event.stop)
            return true; //stopPropagation
        }
      }
    }

    return false;
  },

  /**
   * Triggers and event to every element in an array.
   * If the event returns true, it must be intercepted
   * @method LEvent.triggerArray
   * @param {Array} array contains all instances to triggers the event
   * @param {String} event_name string defining the event name
   * @param {*} parameters that will be received by the binded function
   * @param {bool} reverse_order trigger in reverse order (binded last get called first)
   * @param {bool} expand_parameters parameters are passed not as one single parameter, but as many
   * return {bool} false
   **/
  triggerArray(instances: unknown[], event_type: string, params?: unknown, reverse_order?: boolean, expand_parameters?: boolean): boolean {
    let blocked = false;
    for (let i = 0, l = instances.length; i < l; ++i) {
      const instance = instances[i];
      if (!instance)
        throw "cannot trigger event from null";
      if ((instance as object).constructor === String)
        throw "cannot bind event to a string";

      const events = (instance as LEventTarget).__levents;
      if (!events || !Object.prototype.hasOwnProperty.call(events, event_type))
        continue;

      if (reverse_order) {
        for (let j = events[event_type].length - 1; j >= 0; --j) {
          const v = events[event_type][j];
          if (expand_parameters) {
            if (v[0].apply(v[1], params as unknown[]) === true) { // || event.stop)
              blocked = true;
              break; //stopPropagation
            }
          } else {
            if (v[0].call(v[1], event_type, params) === true) { // || event.stop)
              blocked = true;
              break; //stopPropagation
            }
          }
        }
      } else {
        for (let j = 0, ll = events[event_type].length; j < ll; ++j) {
          const v = events[event_type][j];
          if (expand_parameters) {
            if (v[0].apply(v[1], params as unknown[]) === true) { // || event.stop)
              blocked = true;
              break; //stopPropagation
            }
          } else {
            if (v[0].call(v[1], event_type, params) === true) { // || event.stop)
              blocked = true;
              break; //stopPropagation
            }
          }
        }
      }
    }

    return blocked;
  },

  extendObject(object: object): void {
    const obj = object as {
      bind(event_type: string, callback: LEventCallback, instance?: unknown): void;
      trigger(event_type: string, params?: unknown): boolean;
      unbind(event_type: string, callback: LEventCallback, target_instance?: unknown): void;
      unbindAll(target_instance?: unknown, callback?: LEventCallback): void;
    };

    obj.bind = function (this: object, event_type: string, callback: LEventCallback, instance?: unknown): void {
      return LEvent.bind(this, event_type, callback, instance);
    };

    obj.trigger = function (this: object, event_type: string, params?: unknown): boolean {
      return LEvent.trigger(this, event_type, params);
    };

    obj.unbind = function (this: object, event_type: string, callback: LEventCallback, target_instance?: unknown): void {
      return LEvent.unbind(this, event_type, callback, target_instance);
    };

    obj.unbindAll = function (this: object, target_instance?: unknown, callback?: LEventCallback): void {
      return LEvent.unbindAll(this, target_instance, callback);
    };
  },

  /**
   * Adds the methods to bind, trigger and unbind to this class prototype
   * @method LEvent.extendClass
   * @param {Object} constructor
   **/
  extendClass(constructor: Function): void {
    LEvent.extendObject((constructor as { prototype: object }).prototype);
  },
};
