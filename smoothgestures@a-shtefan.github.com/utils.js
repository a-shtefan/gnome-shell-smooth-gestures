const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const SettingsSchemaSource = Gio.SettingsSchemaSource;

function getSchema() {
  const schemaName = Extension.metadata['settings-schema'];

  let schemaDir = Extension.dir.get_child('schemas');
  let schemaSource;
  if (schemaDir.query_exists(null)) {
    schemaSource = SettingsSchemaSource.new_from_directory(
        schemaDir.get_path(),
        SettingsSchemaSource.get_default(),
        false);
  } else {
    schemaSource = SettingsSchemaSource.get_default();
  }

  let schemaObj = schemaSource.lookup(schemaName, true);
  if (!schemaObj)
      throw new Error('Schema ' + schema + ' could not be found for extension '
                      + Extension.metadata.uuid + '. Please check your installation.');

  return new Gio.Settings({ settings_schema: schemaObj });
}
