var MethodWrapper = class MethodWrapper {
  constructor() {
    this._methodsWrapped = [];
  }

  wrapMethod(obj, methodName, wrapperMethod) {
    const oldMethod = obj[methodName];
    obj[methodName] = function(...args) {
      return wrapperMethod.call(this, oldMethod, ...args);
    }
    this._methodsWrapped.push({obj, methodName, oldMethod});
  }

  unwrapAllMethods() {
    for (let i = this._methodsWrapped.length - 1; i >= 0; i--) {
      let wrap = this._methodsWrapped[i];
      wrap.obj[wrap.methodName] = wrap.oldMethod;
    }
  }
}
