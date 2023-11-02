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
   * @param value The value of the cache
   * @param version The version of the cache. If the version is smaller than the current version, the cache will not be updated.
   */
  set(key, value, version) {
    const cached = this._keys.get(key);

    const keyUpdated = cached === undefined || version > cached.version;
    if (!keyUpdated) {
      return;
    }

    this._keys.set(key, {version, value});
  }
}
