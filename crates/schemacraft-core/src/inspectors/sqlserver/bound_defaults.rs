//! Legacy defaults created with `CREATE DEFAULT` and bound with `sp_bindefault`.
//!
//! SQL Server keeps no expression for them, only the statement that created them, which
//! `OBJECT_DEFINITION` returns, e.g. `CREATE DEFAULT dbo.Zero AS 0;` followed by a line break.
//! The expression is read out of that statement so it looks like any other default.

/// The expression of a bound default, read from its `CREATE DEFAULT name AS expression`
/// statement without the trailing semicolon. A statement of another shape is kept whole.
pub(super) fn bound_default_expression(statement: &str) -> String {
    expression_of_create_default(statement)
        .unwrap_or(statement)
        .trim()
        .trim_end_matches(|character: char| character == ';' || character.is_whitespace())
        .to_string()
}

fn expression_of_create_default(statement: &str) -> Option<&str> {
    let rest = keyword(skip_trivia(statement), "CREATE")?;
    let rest = keyword(skip_trivia(rest), "DEFAULT")?;
    let rest = multipart_name(skip_trivia(rest))?;
    let expression = skip_trivia(keyword(skip_trivia(rest), "AS")?);
    let has_expression = !expression
        .trim_end_matches(|character: char| character == ';' || character.is_whitespace())
        .is_empty();
    has_expression.then_some(expression)
}

/// Skips whitespace and comments, including nested block comments as T-SQL allows them.
fn skip_trivia(mut text: &str) -> &str {
    loop {
        text = text.trim_start();
        if let Some(rest) = text.strip_prefix("--") {
            text = rest.split_once('\n').map_or("", |(_, after)| after);
        } else if text.starts_with("/*") {
            text = after_block_comment(text);
        } else {
            return text;
        }
    }
}

fn after_block_comment(text: &str) -> &str {
    let mut depth = 0_usize;
    let mut rest = text;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("/*") {
            depth += 1;
            rest = after;
        } else if let Some(after) = rest.strip_prefix("*/") {
            depth = depth.saturating_sub(1);
            rest = after;
            if depth == 0 {
                return rest;
            }
        } else {
            let mut characters = rest.chars();
            characters.next();
            rest = characters.as_str();
        }
    }
    rest
}

/// The text after `word`, which must be a whole keyword in any letter case.
fn keyword<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    let head = text.get(..word.len())?;
    let rest = text.get(word.len()..)?;
    let ends_there = !rest.chars().next().is_some_and(is_identifier_character);
    (head.eq_ignore_ascii_case(word) && ends_there).then_some(rest)
}

/// The text after a name such as `dbo.Zero`, `[dbo].[Zero as One]` or `"odd""name"`.
fn multipart_name(text: &str) -> Option<&str> {
    let mut rest = identifier(text)?;
    loop {
        let after_space = skip_trivia(rest);
        let Some(after_dot) = after_space.strip_prefix('.') else {
            return Some(rest);
        };
        rest = identifier(skip_trivia(after_dot))?;
    }
}

fn identifier(text: &str) -> Option<&str> {
    match text.chars().next()? {
        '[' => after_delimited(text, ']'),
        '"' => after_delimited(text, '"'),
        first if first.is_alphabetic() || matches!(first, '_' | '@' | '#') => {
            let end = text
                .find(|character: char| !is_identifier_character(character))
                .unwrap_or(text.len());
            text.get(end..)
        }
        _ => None,
    }
}

/// The text after an identifier opened by its first character and closed by `close`, which is
/// escaped inside the name by doubling it.
fn after_delimited(text: &str, close: char) -> Option<&str> {
    let mut rest = text.get(1..)?;
    loop {
        let position = rest.find(close)?;
        let after = rest.get(position + close.len_utf8()..)?;
        match after.strip_prefix(close) {
            Some(escaped) => rest = escaped,
            None => return Some(after),
        }
    }
}

fn is_identifier_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '@' | '#' | '$')
}

#[cfg(test)]
mod tests {
    use super::bound_default_expression;

    #[test]
    fn reads_the_expression_of_a_bound_default() {
        let cases = [
            // What OBJECT_DEFINITION returns, trailing semicolon and line break included.
            ("CREATE DEFAULT dbo.verify_df_legacy AS 42;\n", "42"),
            ("CREATE DEFAULT dbo.LegacyZero AS 0", "0"),
            ("create default Today as getdate()", "getdate()"),
            (
                "-- legacy rule\nCREATE DEFAULT [dbo].[Zero as One] AS 1",
                "1",
            ),
            (
                "/* outer /* nested */ still a comment */ CREATE DEFAULT \"odd\"\"name\" AS 'N/A' ;  ",
                "'N/A'",
            ),
            (
                "CREATE DEFAULT [we]]ird] AS /* why */ (10 * 2);",
                "(10 * 2)",
            ),
        ];
        for (statement, expression) in cases {
            assert_eq!(
                bound_default_expression(statement),
                expression,
                "{statement}"
            );
        }
    }

    #[test]
    fn keeps_a_bound_default_of_another_shape_whole() {
        assert_eq!(
            bound_default_expression("  something unexpected;\n"),
            "something unexpected"
        );
        assert_eq!(
            bound_default_expression("CREATE DEFAULT dbo.Empty AS ;"),
            "CREATE DEFAULT dbo.Empty AS"
        );
        assert_eq!(
            bound_default_expression("CREATE DEFAULTS dbo.X AS 1"),
            "CREATE DEFAULTS dbo.X AS 1"
        );
    }
}
