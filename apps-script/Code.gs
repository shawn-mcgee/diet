/* Set Script Properties CLIENT_ID, ALLOWED_EMAIL, SPREADSHEET_ID before deployment.
 * Deploy as a web app: execute as yourself, access Anyone.
 * Anonymous requests are rejected by the application before accessing the Sheet.
 */
function doPost(e) {
  var lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 4 * 1024 * 1024) throw new Error('Invalid request size.');
    var request = JSON.parse(e.postData.contents);
    var user = authenticate_(request.credential);
    if (request.action !== 'load' && request.action !== 'save') throw new Error('Unknown action.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Sheet is busy. Retry in a moment.');
    var sheet = getSheet_();
    var current = readState_(sheet);
    var currentRevision = revision_(current);
    if (request.action === 'load') return json_({ ok: true, user: user, state: current, revision: currentRevision });
    if (request.revision !== currentRevision) {
      return json_({ ok: false, code: 'CONFLICT', error: 'The Sheet changed. Export your local edits, then use Load Sheet before making further changes.' });
    }
    var next = validateState(request.state);
    writeState_(sheet, next);
    return json_({ ok: true, revision: revision_(next) });
  } catch (error) {
    return json_({ ok: false, error: error.message || 'Backend error.' });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function doGet() {
  return json_({ ok: true, service: 'Daily diet API', message: 'Use authenticated POST requests.' });
}

function authenticate_(credential) {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('CLIENT_ID');
  var allowedEmail = props.getProperty('ALLOWED_EMAIL');
  if (!clientId || !allowedEmail) throw new Error('Configure CLIENT_ID and ALLOWED_EMAIL in Script Properties.');
  if (typeof credential !== 'string' || credential.length > 10000 || !credential) throw new Error('Sign in with Google first.');
  // Google's endpoint verifies the signature. Claims are checked here as well.
  // Cache only verified claims, briefly, to avoid a verification call for every edit.
  var key = 'identity:' + digest_(credential);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  var claims;
  if (cached) claims = JSON.parse(cached);
  else {
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('Google session expired or invalid. Sign out and sign in again.');
    claims = JSON.parse(response.getContentText());
  }
  if (claims.aud !== clientId || ['accounts.google.com', 'https://accounts.google.com'].indexOf(claims.iss) === -1 || Number(claims.exp) <= Date.now() / 1000 || !claims.sub || String(claims.email_verified) !== 'true' || String(claims.email).toLowerCase() !== allowedEmail.trim().toLowerCase()) {
    throw new Error('This Google account is not authorized, or its session has expired.');
  }
  if (!cached) cache.put(key, JSON.stringify(claims), Math.max(1, Math.min(300, Math.floor(Number(claims.exp) - Date.now() / 1000))));
  return { sub: claims.sub, email: claims.email };
}

function getSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Configure SPREADSHEET_ID in Script Properties.');
  var spreadsheet = SpreadsheetApp.openById(id);
  return spreadsheet.getSheetByName('Diet') || spreadsheet.insertSheet('Diet');
}

function readState_(sheet) {
  var rows = sheet.getDataRange().getValues();
  if (rows.length === 1 && rows[0].every(function(value) { return value === ''; })) return null;
  if (rows.length < 4 || rows[3][0] !== 'state.0') throw new Error('The Diet tab layout is invalid. Restore its state rows from a backup.');
  var encoded = rows.slice(3).filter(function(row) { return String(row[0]).indexOf('state.') === 0; }).map(function(row) { return row[1]; }).join('');
  var raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8');
  var state = JSON.parse(raw);
  state.settings = { calorieLimit: Number(rows[1][1]), proteinGoal: Number(rows[2][1]) };
  return validateState(state);
}

function writeState_(sheet, state) {
  // One setValues call writes the complete snapshot and editable goals together.
  // Base64 avoids spreadsheet formula interpretation and the 50k cell limit.
  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(state), Utilities.Charset.UTF_8);
  var rows = [['key', 'value'], ['calorieLimit', state.settings.calorieLimit], ['proteinGoal', state.settings.proteinGoal]];
  for (var i = 0; i < encoded.length; i += 40000) rows.push(['state.' + (i / 40000), encoded.slice(i, i + 40000)]);
  var height = Math.max(rows.length, sheet.getLastRow());
  while (rows.length < height) rows.push(['', '']);
  if (height > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), height - sheet.getMaxRows());
  sheet.getRange(1, 1, height, 2).setValues(rows);
  SpreadsheetApp.flush();
}

function revision_(state) { return digest_(JSON.stringify(state)); }
function digest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
