const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;

class Slider {
  constructor() {
    this._latestProgress = 0;
  }

  update() {
    this.setProgress(this._latestProgress);
  }

  setProgress(progress) {
    this._latestProgress = progress;
    this._doSetProgress(progress);
  }

  // This method should be overriden in subclasses.
  _doSetProgress(progress) {
    throw new TypeError(`Abstract method.`);
  }

  animateToStart(duration, callback) {
    throw new TypeError(`Abstract method`);
  }

  animateToEnd(duration, callback) {
    throw new TypeError(`Abstract method`);
  }
};

var ActorPropertiesSlider = class ActorPropertiesSlider extends Slider {
  constructor(actor, startVals, endVals) {
    super();
    this._actor = actor;
    this._startVals = startVals;
    this._endVals = endVals;
  }

  get startVals() {
    return this._startVals;
  }

  set startVals(vals) {
    this._startVals = vals;
  }

  get endVals() {
    return this._endVals;
  }

  set endVals(vals) {
    this._endVals = vals;
  }

  _doSetProgress(progress) {
    for (let property in this._startVals) {
      if (!(property in this._endVals)) {
        continue;
      }
      let startVal = this._startVals[property];
      let endVal = this._endVals[property];
      this._actor[property] = endVal * progress + startVal * (1 - progress);
    }
  }

  _animateTo(duration, values, callback) {
    let params = {
      duration: duration,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    };
    for (let property in values) {
      params[property] = values[property];
      if (property == "opacity") {
        params[property] = Math.min(255, Math.max(0, params[property]));
      }
    }
    if (callback) {
      params.onComplete = callback;
    }
    this._actor.ease(params);
  }

  animateToStart(duration, callback) {
    this._animateTo(duration, this._startVals, callback);
  }

  animateToEnd(duration, callback) {
    this._animateTo(duration, this._endVals, callback);
  }
};

var TeeSlider = class TeeSlider extends Slider {
  constructor(sliders) {
    super();
    this._sliders = sliders;
  }

  addSlider(slider) {
    const ix = this._sliders.indexOf(slider);
    if (ix >= 0) return;
    this._sliders.push(slider);
  }

  removeSlider(slider) {
    const ix = this._sliders.indexOf(slider);
    if (ix < 0) return;
    this._sliders.splice(ix, 1);
  }

  _doSetProgress(progress) {
    for (let slider of this._sliders) {
      slider.setProgress(progress);
    }
  }

  _animateTo(duration, to, callback) {
    let numDone = 0;
    let sliderCallback = () => {
      ++numDone;
      if (numDone == this._sliders.length && callback) {
        callback();
      }
    };
    for (let slider of this._sliders) {
      if (to == "start") {
        slider.animateToStart(duration, sliderCallback);
      } else {
        slider.animateToEnd(duration, sliderCallback);
      }
    }
  }

  animateToStart(duration, callback) {
    this._animateTo(duration, "start", callback);
  }

  animateToEnd(duration, callback) {
    this._animateTo(duration, "end", callback);
  }
};

var OverviewControlsSlider = class OverviewControlsSlider extends Slider {
  constructor(dashSlider, thumbnailsSlider) {
    super();
    this._dashSlider = dashSlider;
    this._thumbnailsSlider = thumbnailsSlider;
  }

  _doSetProgress(progress) {
    this._dashSlider.layout.slide_x = progress * this._dashSlider._getSlide();
    this._thumbnailsSlider.layout.slide_x =
        progress * this._thumbnailsSlider._getSlide();
  }

  animateToStart(duration, callback) {
    this._dashSlider.ease_property('@layout.slide-x', 0, {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: duration,
    });
    this._thumbnailsSlider.ease_property('@layout.slide-x', 0, {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: duration,
    });
  }

  animateToEnd(duration, callback) {
    this._dashSlider.ease_property(
        '@layout.slide-x', this._dashSlider._getSlide(), {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: duration,
    });
    this._thumbnailsSlider.ease_property(
        '@layout.slide-x', this._thumbnailsSlider._getSlide(), {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: duration,
    });
  }
}

var SliderWithDelay = class SliderWithDelay extends Slider {
  constructor(slider, delay) {
    super();
    this._slider = slider;
    this._delay = delay;
  }

  _doSetProgress(progress) {
    const delay = this._delay;
    this._slider.setProgress(Math.max(0, (progress - delay) / (1 - delay)));
  }

  animateToStart(duration, callback) {
    this._slider.animateToStart(duration, callback);
  }

  animateToEnd(duration, callback) {
    this._slider.animateToEnd(duration, callback);
  }
}

var ThresholdSlider = class ThresholdSlider extends Slider {
  constructor(actor, property, startVal, endVal, threshold) {
    super();
    this._actor = actor;
    this._property = property;
    this._startVal = startVal;
    this._endVal = endVal;
    this._threshold = threshold;
  }

  _doSetProgress(progress) {
    if (progress > this._threshold) {
      this._actor[this._property] = this._endVal;
    } else {
      this._actor[this._property] = this._startVal;
    }
  }

  animateToStart(duration, callback) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
      this._actor[this._property] = this._startVal;
      callback();
    });
  }

  animateToEnd(duration, callback) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
      this._actor[this._property] = this._endVal;
      callback();
    });
  }
}
