export class Cache {
  constructor() {
    this._keys = new Map();
  }

  /**
   * @param key The key of the cache
   * @returns {*} The value of the cache as set by the `set` method.
   */
  get(key) {
    return this._keys.get(key)?.value;
  }

  /**
   * @param key The key of the cache
   * @param createValue A callback to create the value of the cache if it is needed.
   * @param version The version of the cache. If the version is smaller than the current version, the cache will not be updated.
   */
  set(key, createValue, version) {
    const cached = this._keys.get(key);

    const keyUpdated = cached === undefined || version > cached.version;
    if (!keyUpdated) {
      return;
    }

    this._keys.set(key, {version, value: createValue()});
  }
}
