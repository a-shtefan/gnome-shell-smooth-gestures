const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Extension.imports.utils;

let schema = null;

function init() {
    schema = Utils.getSchema();
}

const SmoothGesturesSettingsWidget = new GObject.Class({
    Name: 'SmoothGestures.prefs.SmoothGesturesSettingsWidget',
    GTypeName: 'SmoothGesturesSettingsWidget',
    Extends: Gtk.VBox,

    _init(params) {
        this.parent (params);

        this._buildUI();
        this._initUI();
    },

    _buildUI() {
      const frameStyle = {
          valign: Gtk.Align.CENTER,
          margin: 10
      };
      const gridStyle = {
          margin: 30,
          column_homogeneous: false,
          column_spacing: 20,
          row_homogeneous: false,
          row_spacing: 5
      };

      // The sensitivity options
      this._sensitivityOptionsFrame = new Gtk.Frame(frameStyle);
      this._sensitivityOptionsGrid = new Gtk.Grid(gridStyle);
      this._sensitivityOptionsFrame.add(this._sensitivityOptionsGrid);

      // Sensitivity
      this._sensitivityLabel = new Gtk.Label({label: "Sensitivity Adjustment"});
      this._sensitivitySpinButton = Gtk.SpinButton.new_with_range(0, 100, 1);
      this._sensitivityOptionsGrid.attach(this._sensitivityLabel, 0, 0, 1, 1);
      this._sensitivityOptionsGrid.attach(this._sensitivitySpinButton, 1, 0, 1, 1);

      this.add(this._sensitivityOptionsFrame);
    },

    _initUI() {
      // Sensitivity options setup
      schema.bind('sensitivity', this._sensitivitySpinButton, 'value', Gio.SettingsBindFlags.DEFAULT);
    },
});

function buildPrefsWidget() {
    let settingsWidget = new SmoothGesturesSettingsWidget();
    settingsWidget.show_all();
    return settingsWidget;
}
