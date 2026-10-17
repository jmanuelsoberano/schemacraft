import type { RuleMessageCatalog } from "./en";

/**
 * Spanish words of the readable rules. A sentence never makes a word agree with a table or
 * column name, whose gender and number are unknown: tables are named through "fila", and
 * adjectives about a column go through "valor" or are invariable ("igual", "mayor").
 */
export const spanishRuleMessages: RuleMessageCatalog = {
  "rule.check.eq": "{column} debe ser igual a {value}",
  "rule.check.ne": "{column} debe ser diferente de {value}",
  "rule.check.gt": "{column} debe ser mayor que {value}",
  "rule.check.ge": "{column} debe ser mayor o igual que {value}",
  "rule.check.lt": "{column} debe ser menor que {value}",
  "rule.check.le": "{column} debe ser menor o igual que {value}",
  "rule.check.after": "{column} debe ser posterior a {value}",
  "rule.check.onOrAfter": "{column} debe ser igual o posterior a {value}",
  "rule.check.before": "{column} debe ser anterior a {value}",
  "rule.check.onOrBefore": "{column} debe ser igual o anterior a {value}",
  "rule.check.range": "{column} debe estar entre {low} y {high}, ambos incluidos",
  "rule.check.oneOf": "{column} debe ser uno de estos valores: {values}",
  "rule.check.noneOf": "{column} debe ser diferente de {values}",
  "rule.check.required": "{column} debe tener un valor",
  "rule.check.null": "{column} debe ser NULL",
  "rule.check.notBlank": "{column} no puede quedar en blanco ni contener solo espacios",
  "rule.check.notEmpty": "{column} no puede ser un valor vacío",
  "rule.check.startsWith": "{column} debe empezar por {value}",
  "rule.check.endsWith": "{column} debe terminar en {value}, sin contar los espacios finales",
  "rule.check.endsWithExactly": "{column} debe terminar en {value}, sin espacios después",
  "rule.check.contains": "{column} debe contener {value}",
  "rule.check.notContains": "{column} no puede contener {value}",
  "rule.check.matches": "{column} debe seguir el patrón {pattern}",
  "rule.check.notMatches": "{column} no puede seguir el patrón {pattern}",
  "rule.check.onlyDigits":
    "{column} solo puede contener dígitos del 0 al 9; también se admite un valor vacío",
  "rule.check.length.exactly.one":
    "{column} debe tener exactamente {count} carácter, sin contar los espacios finales",
  "rule.check.length.exactly.other":
    "{column} debe tener exactamente {count} caracteres, sin contar los espacios finales",
  "rule.check.length.atLeast.one":
    "{column} debe tener al menos {count} carácter, sin contar los espacios finales",
  "rule.check.length.atLeast.other":
    "{column} debe tener al menos {count} caracteres, sin contar los espacios finales",
  "rule.check.length.atMost.one":
    "{column} debe tener como máximo {count} carácter, sin contar los espacios finales",
  "rule.check.length.atMost.other":
    "{column} debe tener como máximo {count} caracteres, sin contar los espacios finales",
  "rule.check.length.between":
    "{column} debe tener entre {low} y {high} caracteres, ambos incluidos, sin contar los espacios finales",
  "rule.check.bytes.exactly.one": "{column} debe ocupar exactamente {count} byte",
  "rule.check.bytes.exactly.other": "{column} debe ocupar exactamente {count} bytes",
  "rule.check.bytes.atLeast.one": "{column} debe ocupar al menos {count} byte",
  "rule.check.bytes.atLeast.other": "{column} debe ocupar al menos {count} bytes",
  "rule.check.bytes.atMost.one": "{column} debe ocupar como máximo {count} byte",
  "rule.check.bytes.atMost.other": "{column} debe ocupar como máximo {count} bytes",
  "rule.check.bytes.between": "{column} debe ocupar entre {low} y {high} bytes, ambos incluidos",
  "rule.check.whenPresent.one": "Cuando {columns} tiene un valor:",
  "rule.check.whenPresent.other": "Cuando {columns} tienen valor:",
  "rule.check.anyOf": "Debe cumplirse al menos una de estas condiciones:",
  "rule.check.unread":
    "Esta regla no se puede expresar con palabras. Su definición, tal como la guarda SQL Server:",

  "rule.fk.required": "Cada fila de {child} pertenece exactamente a una fila de {parent}",
  "rule.fk.optional.one":
    "Cada fila de {child} pertenece como mucho a una fila de {parent}, y a ninguna cuando {columns} es NULL",
  "rule.fk.optional.other":
    "Cada fila de {child} pertenece como mucho a una fila de {parent}, y a ninguna cuando alguna de las columnas {columns} es NULL",
  "rule.fk.unknown": "Las filas de {child} hacen referencia a filas de {parent} mediante {columns}",
  "rule.fk.self.required":
    "Cada fila de {child} pertenece exactamente a una fila de la misma tabla, que puede ser ella misma",
  "rule.fk.self.optional.one":
    "Cada fila de {child} pertenece como mucho a una fila de la misma tabla, que puede ser ella misma, y a ninguna cuando {columns} es NULL",
  "rule.fk.self.optional.other":
    "Cada fila de {child} pertenece como mucho a una fila de la misma tabla, que puede ser ella misma, y a ninguna cuando alguna de las columnas {columns} es NULL",
  "rule.fk.invisible.required":
    "Cada fila de {child} pertenece exactamente a una fila de una tabla no visible para este inicio de sesión",
  "rule.fk.invisible.optional.one":
    "Cada fila de {child} pertenece como mucho a una fila de una tabla no visible para este inicio de sesión, y a ninguna cuando {columns} es NULL",
  "rule.fk.invisible.optional.other":
    "Cada fila de {child} pertenece como mucho a una fila de una tabla no visible para este inicio de sesión, y a ninguna cuando alguna de las columnas {columns} es NULL",
  "rule.fk.invisible.unknown":
    "Las filas de {child} hacen referencia mediante {columns} a filas de una tabla no visible para este inicio de sesión",
  "rule.fk.parentMany":
    "Una fila de {parent} puede estar referenciada por cualquier número de filas de {child}, o por ninguna",
  "rule.fk.parentOne":
    "Una fila de {parent} puede estar referenciada como mucho por una fila de {child}",
  "rule.fk.self.parentMany":
    "Una fila de {parent} puede estar referenciada por cualquier número de filas de la misma tabla, o por ninguna",
  "rule.fk.self.parentOne":
    "Una fila de {parent} puede estar referenciada como mucho por una fila de la misma tabla",
  "rule.fk.delete.noAction":
    "Borrar una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de {child} que la referencian",
  "rule.fk.self.delete.noAction":
    "Borrar una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que la referencian",
  "rule.fk.delete.cascade":
    "Borrar una fila de {parent} borra también las filas de {child} que la referencian",
  "rule.fk.delete.setNull":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL",
  "rule.fk.delete.setDefault.one":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en su valor por defecto; el borrado se bloquea salvo que otra fila de {parent} tenga ese valor",
  "rule.fk.delete.setDefault.other":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en sus valores por defecto; el borrado se bloquea salvo que otra fila de {parent} tenga esos valores",
  "rule.fk.delete.setDefaultNull.one":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL, porque no tiene valor por defecto",
  "rule.fk.delete.setDefaultNull.other":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL, porque no tienen valores por defecto",
  "rule.fk.delete.setDefaultNeutral.one":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en su valor por defecto, o en NULL si no lo tiene; salvo que el nuevo valor sea NULL, el borrado se bloquea si ninguna otra fila de {parent} lo tiene",
  "rule.fk.delete.setDefaultNeutral.other":
    "Al borrar una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en sus valores por defecto, o en NULL si no los tienen; salvo que alguno de los nuevos valores sea NULL, el borrado se bloquea si ninguna otra fila de {parent} los tiene",
  "rule.fk.update.noAction.one":
    "Cambiar {parentColumns} de una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de {child} que referencian su valor anterior y ninguna fila de {parent} lo tiene",
  "rule.fk.update.noAction.other":
    "Cambiar {parentColumns} de una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de {child} que referencian sus valores anteriores y ninguna fila de {parent} los tiene",
  "rule.fk.self.update.noAction.one":
    "Cambiar {parentColumns} de una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que referencian su valor anterior y ninguna fila lo tiene",
  "rule.fk.self.update.noAction.other":
    "Cambiar {parentColumns} de una fila de {parent} se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que referencian sus valores anteriores y ninguna fila los tiene",
  "rule.fk.update.cascade":
    "Cambiar {parentColumns} de una fila de {parent} cambia también {columns} en las filas de {child} que la referencian",
  "rule.fk.update.setNull":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL",
  "rule.fk.update.setDefault.one":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en su valor por defecto; el cambio se bloquea salvo que, después, una fila de {parent} tenga ese valor",
  "rule.fk.update.setDefault.other":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en sus valores por defecto; el cambio se bloquea salvo que, después, una fila de {parent} tenga esos valores",
  "rule.fk.update.setDefaultNull.one":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL, porque no tiene valor por defecto",
  "rule.fk.update.setDefaultNull.other":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en NULL, porque no tienen valores por defecto",
  "rule.fk.update.setDefaultNeutral.one":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en su valor por defecto, o en NULL si no lo tiene; salvo que el nuevo valor sea NULL, el cambio se bloquea si, después, ninguna fila de {parent} lo tiene",
  "rule.fk.update.setDefaultNeutral.other":
    "Al cambiar {parentColumns} de una fila de {parent}, las filas de {child} que la referenciaban quedan con {columns} en sus valores por defecto, o en NULL si no los tienen; salvo que alguno de los nuevos valores sea NULL, el cambio se bloquea si, después, ninguna fila de {parent} los tiene",
  "rule.fk.update.identity":
    "{parentColumns} es una columna de identidad y nunca cambia, así que ON UPDATE {action} no tiene efecto",
  "rule.fk.sqlNote": "Generado a partir del catálogo; no es la sentencia original",

  "rule.whenEnabled": "Cuando se habilite:",
  "rule.whenEnabled.notRecorded": "Si la regla está habilitada (este archivo no lo registró):",
  "rule.value.now": "la fecha y hora del servidor al guardar el valor",
  "rule.value.utcNow": "la fecha y hora UTC al guardar el valor",
  "rule.value.referencedTable": "la tabla referenciada",
  "rule.value.referencedKey": "la clave referenciada",
  "rule.note.pattern":
    "En un patrón, % equivale a cualquier texto, _ a un carácter cualquiera y [ ] a un carácter de un conjunto.",
  "rule.note.collation":
    "Las comparaciones de texto siguen la intercalación de la columna, que puede no distinguir mayúsculas, acentos o algunos caracteres, y dos textos que solo difieren en los espacios finales cuentan como iguales.",
  "rule.note.derived":
    "SchemaCraft redacta estas reglas a partir de sus definiciones. SQL Server las comprueba al escribir los valores, así que las filas guardadas antes de existir una regla pueden no cumplirla.",
  "rule.sql.show": "Mostrar SQL",
  "rule.sql.hide": "Ocultar SQL",
  "rule.sql.copy": "Copiar SQL",
  "rule.sql.copied": "Copiado",
  "rule.sql.copyFailed": "No se pudo copiar",
};
