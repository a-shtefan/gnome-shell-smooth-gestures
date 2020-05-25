const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Config = imports.misc.config;

const Signals = imports.signals;

const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;
const { Overview, OverviewActor } = imports.ui.overview;
const { ControlsManager } = imports.ui.overviewControls;
const { WindowManager } = imports.ui.windowManager;
const { padArea, Workspace, WindowClone, WindowOverlay } = imports.ui.workspace;
const { WorkspacesView } = imports.ui.workspacesView;

// Extension imports.
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const { ActorPropertiesSlider, TeeSlider, OverviewControlsSlider,
        SliderWithDelay, ThresholdSlider } = Extension.imports.slider;
const Utils = Extension.imports.utils;
const { MethodWrapper } = Extension.imports.wrapMethod;

const Swipe3VerticalState = {
  READY: 0,
  SWIPING_UP: 1,
  SWIPING_DOWN: 2,
  CLOSING: 3,
};

const ANIMATION_DURATION = 200;

// Gesture handler instance.
let gestureHandler = null;

// Settings.
let schema = null;

function init() {
  schema = Utils.getSchema();
}

class SpeedCalculator {
  constructor() {
    this._deltasQueue = [];
    this._totalDelta = {x: 0, y: 0};
  }

  update(dx, dy, time) {
    this._deltasQueue.push({x: dx, y: dy, time: time});
    this._totalDelta.x += dx;
    this._totalDelta.y += dy;
    while (this._deltasQueue.length > 2 &&
           time - this._deltasQueue[0].time > 50000) {
      this._totalDelta.x -= this._deltasQueue[0].x;
      this._totalDelta.y -= this._deltasQueue[0].y;
      this._deltasQueue.shift();
    }
  }

  getSpeed() {
    if (this._deltasQueue.length < 2) return {x: 0, y: 0};
    let timeDelta = this._deltasQueue[this._deltasQueue.length - 1].time -
                    this._deltasQueue[0].time;
    return {x: this._totalDelta.x * 10000 / timeDelta,
            y: this._totalDelta.y * 10000 / timeDelta};
  }
}

function stackTrace() {
  let error = new Error();
  return error.stack.substring(error.stack.indexOf("\n"));
}

const SmoothGestures = class SmoothGestures {
  constructor(actor) {
    this._init(actor)
  }

  _init(actor) {
    this._dx = 0;
    this._dy = 0;
    this._speedCalculator = null;

    this._state = Swipe3VerticalState.READY;

    this._updateSettings();

    this._gestureCallbackID = actor.connect(
        'captured-event', this._handleEvent.bind(this));
    this._updateSettingsCallbackID = schema.connect(
        'changed', this._updateSettings.bind(this));

    this._swipeSlider = null;
    this._cleanupId = 0;

    this._methodWrapper = new MethodWrapper();


    let self = this;

    this._methodWrapper.wrapMethod(
        WorkspacesView.prototype, "_init",
        function(_init, ...rest) {
          _init.call(this, ...rest);
          Main.overview.disconnect(this._overviewShownId);
          this._overviewShownId = Main.overview.connect('shown', () => {});
        }
    )

    this._methodWrapper.wrapMethod(
        Workspace.prototype, "_init",
        function(_init, ...rest) {
          _init.call(this, ...rest);
          for (let clone of this._windows) {
            clone.__startX = clone.x;
            clone.__startY = clone.y;
            clone.__startTX = clone.translation_x;
            clone.__startTY = clone.translation_y;

            clone.__startWidth = clone.width
            clone.__startHeight = clone.height
          }
        })

    this._methodWrapper.wrapMethod(
        Workspace.prototype, "_updateWindowPositions",
        function(_updateWindowPositions, flags) {
          if (self._state == Swipe3VerticalState.READY) {
            return _updateWindowPositions.call(this, flags);
          }
          if (this._currentLayout == null) {
            this._recalculateWindowPositions(flags);
            return;
          }

          let layout = this._currentLayout;
          let strategy = layout.strategy;

          let [, , padding] = this._getSpacingAndPadding();
          let area = padArea(this._actualGeometry, padding);
          let slots = strategy.computeWindowSlots(layout, area);

          for (let i = 0; i < slots.length; i++) {
            let slot = slots[i];
            let [x, y, scale, clone] = slot;

            clone.slotId = i;

            let cloneWidth = clone.width * scale;
            let cloneHeight = clone.height * scale;
            clone.slot = [x, y, cloneWidth, cloneHeight];

            let cloneCenter = x + cloneWidth / 2;
            let maxChromeWidth = 2 * Math.min(
                cloneCenter - area.x,
                area.x + area.width - cloneCenter);
            clone.overlay.setMaxChromeWidth(Math.round(maxChromeWidth));

            if (!clone.positioned) {
              // This window appeared after the overview was already up
              // Grow the clone from the center of the slot
              clone.x = x + cloneWidth / 2;
              clone.y = y + cloneHeight / 2;
              clone.scale_x = 0;
              clone.scale_y = 0;
              clone.positioned = true;
            }

            if (!clone._properties_slider) {
              clone._properties_slider =
                  new ActorPropertiesSlider(clone, {}, {});
              clone.connect('destroy', function() {
                if (self._swipeSlider && this &&
                    this._properties_slider) {
                  self._swipeSlider.removeSlider(
                      this._properties_slider);
                }
              });
              if (self._swipeSlider) {
                self._swipeSlider.addSlider(clone._properties_slider);
              }
            }
            let real = clone.realWindow;
            clone._properties_slider.startVals = {
                x: clone.__startX, y: clone.__startY,
                translation_x: clone.__startTX, translation_y: clone.__startTY,
                scale_x: 1, scale_y: 1,
            }
            clone._properties_slider.endVals = {
                x: 0, y: 0,
                translation_x: x, translation_y: y,
                scale_x: scale, scale_y: scale,
            }
            clone._properties_slider.update();
            clone.overlay.title.text = clone.overlay._getCaption();
            clone.overlay.relayout(false);
            clone.overlay.hide();
            this._showWindowOverlay(clone, clone.overlay);
          }

          this._windowOverlaysGroup.visible = false;
          if (!this._overlayVisibilitySlider) {
            this._overlayVisibilitySlider = new ThresholdSlider(
                this._windowOverlaysGroup, "visible", false, true, 0.99999,
            );

            this._windowOverlaysGroup.connect('destroy', function() {
              if (self._swipeSlider && this &&
                  this._overlayVisibilitySlider) {
                self._swipeSlider.removeSlider(
                    this._overlayVisibilitySlider);
              }
            });
            self._swipeSlider.addSlider(
                this._overlayVisibilitySlider);
          }
        });

    this._cleanupId = Main.overview.connect('hidden', () => {
      if (this._controlsSlider) {
        this._controlsSlider.setProgress(1);
        this._controlsSlider = null;
      }
      this._swipeSlider = null;
      this._state = Swipe3VerticalState.READY;
    });
  }


  _handleEvent(actor, event) {
      if (event.type() != Clutter.EventType.TOUCHPAD_SWIPE)
        return Clutter.EVENT_PROPAGATE;

      if (event.get_touchpad_gesture_finger_count() != 3)
        return Clutter.EVENT_PROPAGATE;

      if (event.get_gesture_phase() == Clutter.TouchpadGesturePhase.BEGIN) {
        if (this._state !== Swipe3VerticalState.READY) return;
        this._speedCalculator = new SpeedCalculator();
        this._dx = 0;
        this._dy = 0;
        this._initSwipeUp();
      } else if (event.get_gesture_phase() ==
                 Clutter.TouchpadGesturePhase.UPDATE) {
        if (this._state !== Swipe3VerticalState.SWIPING_UP &&
            this._state !== Swipe3VerticalState.SWIPING_DOWN) return;
        let [dx, dy] = event.get_gesture_motion_delta();
        const curTime = GLib.get_monotonic_time();
        this._speedCalculator.update(dx, dy, curTime);
        this._dx += dx;
        this._dy += dy;
        this._swipeUpProgress();
      } else {
        if (this._state !== Swipe3VerticalState.SWIPING_UP &&
            this._state !== Swipe3VerticalState.SWIPING_DOWN) return;
        this._finishSwipeUp();
      }

      return Clutter.EVENT_STOP;
  }

  _initSwipeUp() {
    if (this._swipeSlider || Main.overview.visible) {
      this._state = Swipe3VerticalState.SWIPING_DOWN;
    } else {
      this._state = Swipe3VerticalState.SWIPING_UP;
      this._setupWorkspace();
    }
    this._swipeUpProgress();
  }

  _setupWorkspace() {
    let dashSlider = Main.overview._overview._controls._dashSlider;
    let thumbnailsSlider = Main.overview._overview._controls._thumbnailsSlider;
    dashSlider.remove_transition('@layout.slide-x');
    dashSlider.remove_transition('@layout.translation-x');
    thumbnailsSlider.remove_transition('@layout.slide-x');
    thumbnailsSlider.remove_transition('@layout.translation-x');
    // let slidersSlider = new OverviewControlsSlider(
    //     dashSlider, thumbnailsSlider);
    // slidersSlider.setProgress(0);
    this._controlsSlider = new SliderWithDelay(new TeeSlider([
        new ActorPropertiesSlider(
            dashSlider, {opacity: 0}, {opacity: 255}),
        new ActorPropertiesSlider(
            thumbnailsSlider, {opacity: 0}, {opacity: 255}),
        new ActorPropertiesSlider(
            Main.overview._coverPane, {opacity: 0}, {opacity: 255}),
        new ActorPropertiesSlider(
            Main.overview._overview._searchEntry, {opacity: 0}, {opacity: 255}),
    ]), 0.7);
    this._swipeSlider = new TeeSlider([this._controlsSlider]);

    Main.overview.show();

    Main.overview._coverPane.remove_all_transitions();
    for (let background of Main.overview._backgroundGroup.get_children()) {
      if (!background._properties_slider) {
        background._properties_slider =
            new ActorPropertiesSlider(background, {
                'brightness': 1.0,
                'vignette-sharpness': 0.0
            }, {
                'brightness': Lightbox.VIGNETTE_BRIGHTNESS,
                'vignette-sharpness': Lightbox.VIGNETTE_SHARPNESS
            });
      }
      this._swipeSlider.addSlider(
          new SliderWithDelay(background._properties_slider, 0.7));
      background.remove_all_transitions()
    }
  }

  _getProgress() {
    if (this._state === Swipe3VerticalState.SWIPING_UP) {
      let magnitude = Math.max(-this._dy, 0);
      return Math.min(1.0, magnitude / 200 * this._sensitivity);
    } else if (this._state === Swipe3VerticalState.SWIPING_DOWN) {
      let magnitude = Math.max(this._dy, 0);
      return 1 - Math.min(1.0, magnitude / 200 * this._sensitivity);
    }
  }

  _swipeUpProgress() {
    if (this._swipeSlider) {
      this._swipeSlider.setProgress(this._getProgress());
    }
  }

  _finishSwipeUp() {
    const speed = this._speedCalculator.getSpeed();
    const progress = this._getProgress();

    let isUp;
    if (this._state === Swipe3VerticalState.SWIPING_UP) {
      isUp = speed.y < -2 || (progress > 0.4 && speed.y < -0.1) ||
             (progress > 0.6 && speed.y <= 0);
    } else if (this._state === Swipe3VerticalState.SWIPING_DOWN) {
      isUp = !(speed.y > 2 || (progress < 0.6 && speed.y > 0.1) ||
               (progress < 0.4 && speed.y >= 0));
    }

    this._state = Swipe3VerticalState.CLOSING;
    if (isUp) {
      this._swipeSlider.animateToEnd(ANIMATION_DURATION);
      this._state = Swipe3VerticalState.READY;
    } else {
      Main.overview.hide();
    }
  }

  _printActorCoordinates(prefix, actor) {
    log(
        `${prefix}: (x,y): (${actor.x}, ${actor.y}), ` +
        `(tx,ty): (${actor.translation_x}, ${actor.translation_y}), ` +
        `(ax,ay): (${actor.anchor_x}, ${actor.anchor_y}), ` +
        `(px,py): (${actor.pivot_point.x}, ${actor.pivot_point.y}), ` +
        `(sx,sy): (${actor.scale_x}, ${actor.scale_y})`);
  }

  _printBox(prefix, bbox) {
    log(`${prefix}: (x,y): (${bbox.x}, ${bbox.y}), ` +
        `(w,h): (${bbox.width}, ${bbox.height})`);
  }

  _updateSettings() {
    this._sensitivity = (schema.get_int('sensitivity') + 50) / 150;
  }

  _cleanup() {
    global.stage.disconnect(this._gestureCallbackID);
    schema.disconnect(this._updateSettingsCallbackID);
    this._methodWrapper.unwrapAllMethods();
  }
}

function enable() {
    Signals.addSignalMethods(SmoothGestures.prototype);
    gestureHandler = new SmoothGestures(global.stage);
}

function disable() {
    gestureHandler._cleanup();
    Main.wm._workspaceTracker._workspaces.forEach( ws => {
        delete ws.stashedWindows;
    });
}
