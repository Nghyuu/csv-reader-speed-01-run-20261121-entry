// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Reads a CSV text once, left to right, and answers exactly as csv-reader
// 1.0.0 does: {columns, rows, errors}. Records are taken three ways, in
// order of cost:
//
//   - a record with no quote and no stray carriage return is one slice of
//     the line and a split on commas;
//   - a record holding quotes takes a repair pass: the line is split on
//     commas, plain fields are kept as they stand, and only a field that
//     opens with a quote is walked to its closing quote, its "" undone and
//     what follows it appended as it stands. A quoted field that never
//     closes inside the line is not repaired here;
//   - anything left — a quoted field that spans lines, or one that never
//     closes — is read field by field, following the reference's broken-row
//     policy exactly.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module; run(input) is the only export.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

const QC = 34; // "
const CC = 44; // ,
const LF = 10; // \n
const CR = 13; // \r

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  // A U+FEFF at the very start of the text is dropped.
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. A CR not followed by LF is dropped and reported (stray_cr).
  // Returns the field, how it ended, and how many characters were kept.
  function readUnquoted(value, recordLine, recordRow) {
    let added = 0;
    while (pos < len) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      const ri = text.indexOf('\r', pos);
      let next = -1;
      let kind = 0;
      if (ci !== -1) {
        next = ci;
        kind = 0;
      }
      if (ni !== -1 && (next === -1 || ni < next)) {
        next = ni;
        kind = 1;
      }
      if (ri !== -1 && (next === -1 || ri < next)) {
        next = ri;
        kind = 2;
      }
      if (next === -1) {
        value += text.slice(pos);
        added += len - pos;
        pos = len;
        return { value, ended: END, added };
      }
      if (kind === 0) {
        value += text.slice(pos, next);
        added += next - pos;
        pos = next + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        value += text.slice(pos, next);
        added += next - pos;
        pos = next + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: a line break when followed by LF, else a stray one, dropped.
      if (text.charCodeAt(next + 1) === LF) {
        value += text.slice(pos, next);
        added += next - pos;
        pos = next + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      value += text.slice(pos, next);
      added += next - pos;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = next + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted(recordLine, recordRow) {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const q = text.indexOf('"', pos);
      if (q === -1) break;
      const nlIn = text.indexOf('\n', pos);
      const crIn = text.indexOf('\r', pos);
      if ((nlIn === -1 || nlIn >= q) && (crIn === -1 || crIn >= q)) {
        value += text.slice(pos, q);
      } else {
        // The span holds a line break: count it, and read CR and CRLF as LF.
        for (let i = pos; i < q; i++) {
          const c = text.charCodeAt(i);
          if (c === CR) {
            value += '\n';
            line += 1;
            if (text.charCodeAt(i + 1) === LF) i += 1;
          } else {
            if (c === LF) line += 1;
            value += text[i];
          }
        }
      }
      if (text.charCodeAt(q + 1) === QC) {
        // A doubled quote is one quote inside the field.
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"', recordLine, recordRow);
    }
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === CC) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value, recordLine, recordRow);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Parses one record's line, the text up to its line break with the
  // break's CR stripped, when every quoted field closes inside it. A
  // quoted field that never closes in the line returns null: the record
  // spans lines, or its quote never closes at all. Errors are collected
  // apart and only kept when the parse succeeds, so a bail leaves none.
  // `breaks` counts the line breaks a lone CR inside a quoted field is.
  function repairRecord(span, recordLine, recordRow) {
    const parts = span.split(',');
    const fields = [];
    const errs = [];
    let breaks = 0;
    let lastQuoted = false;
    let i = 0;
    while (i < parts.length) {
      const part = parts[i];
      if (part.charCodeAt(0) !== QC) {
        // A plain field: a quote inside it is literal, a CR is stray.
        const cr = part.indexOf('\r');
        if (cr === -1) {
          fields.push(part);
        } else {
          const stripped = part.replaceAll('\r', '');
          for (let n = part.length - stripped.length; n > 0; n--) {
            errs.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          fields.push(stripped);
        }
        lastQuoted = false;
        i += 1;
        continue;
      }
      // A field that opens with a quote: walk to its closing quote over
      // the parts it spans. The line holds no LF, so a quote inside the
      // field can only be doubled, never a line break of its own.
      let raw = part;
      let j = i;
      let closed = -1;
      while (true) {
        let k = 1;
        while (true) {
          const qq = raw.indexOf('"', k);
          if (qq === -1) break;
          if (raw.charCodeAt(qq + 1) === QC) {
            k = qq + 2;
            continue;
          }
          closed = qq;
          break;
        }
        if (closed !== -1) break;
        j += 1;
        if (j >= parts.length) return null;
        raw += ',' + parts[j];
      }
      let content = raw.slice(1, closed).replaceAll('""', '"');
      const crIn = content.indexOf('\r');
      if (crIn !== -1) {
        // A lone CR inside quotes is one LF, and one line more.
        for (let m = crIn; m < content.length; m++) {
          if (content.charCodeAt(m) === CR) breaks += 1;
        }
        content = content.replaceAll('\r', '\n');
      }
      // What follows the closing quote, to the end of its part, is
      // appended as it stands, stray CRs dropped.
      let value = content;
      const junk = raw.slice(closed + 1);
      if (junk.length > 0) {
        const stripped = junk.replaceAll('\r', '');
        for (let n = junk.length - stripped.length; n > 0; n--) {
          errs.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        if (stripped.length > 0) {
          value += stripped;
          errs.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
      }
      fields.push(value);
      lastQuoted = true;
      i = j + 1;
    }
    return { fields, breaks, quoted: lastQuoted, errs };
  }

  // A record's fields, read to its end: the header, a data row, or no
  // record at all when the line held only stray CRs.
  function finishRecord(fields, quoted, recordLine, recordRow) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    // The record's line: up to its line break, the break's CR stripped.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    let span = text.slice(pos, end);
    if (nl !== -1 && span.charCodeAt(span.length - 1) === CR) span = span.slice(0, -1);

    if (span.indexOf('"') === -1 && span.indexOf('\r') === -1) {
      // Fast path: no quote, no stray CR — one split on commas.
      const fields = span.split(',');
      pos = nl === -1 ? len : nl + 1;
      if (nl !== -1) line += 1;
      finishRecord(fields, false, recordLine, recordRow);
      continue;
    }

    const repaired = repairRecord(span, recordLine, recordRow);
    if (repaired !== null) {
      pos = nl === -1 ? len : nl + 1;
      if (nl !== -1) line += 1;
      line += repaired.breaks;
      for (const e of repaired.errs) errors.push(e);
      finishRecord(repaired.fields, repaired.quoted, recordLine, recordRow);
      continue;
    }

    // Slow path: a quoted field spans lines, or never closes.
    const fields = [];
    let quoted = false;
    let field;
    do {
      quoted = text.charCodeAt(pos) === QC;
      field = quoted
        ? readQuoted(recordLine, recordRow)
        : readUnquoted('', recordLine, recordRow);
      fields.push(field.value);
    } while (field.ended === COMMA);
    finishRecord(fields, quoted, recordLine, recordRow);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
