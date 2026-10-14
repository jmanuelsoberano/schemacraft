use std::sync::{Arc, OnceLock};

use usvg::fontdb::Database;

/// Family name the diagram uses for ordinary text; matches the bundled TTF files.
pub const SANS_FAMILY: &str = "Inter";
/// Family name the diagram uses for identifiers and types; matches the bundled TTF files.
pub const MONO_FAMILY: &str = "JetBrains Mono";

/// Static faces generated from the Fontsource packages by `scripts/prepare-fonts.mjs`.
const BUNDLED_FACES: [&[u8]; 4] = [
    include_bytes!("../../assets/fonts/Inter-Regular.ttf"),
    include_bytes!("../../assets/fonts/Inter-SemiBold.ttf"),
    include_bytes!("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    include_bytes!("../../assets/fonts/JetBrainsMono-SemiBold.ttf"),
];

/// Font database shared by every export: the bundled faces, then the system fonts for the
/// characters the bundled Latin subsets lack. Scanning the system fonts costs a moment, so it
/// happens once per process.
pub(crate) fn font_database() -> Arc<Database> {
    static DATABASE: OnceLock<Arc<Database>> = OnceLock::new();
    DATABASE
        .get_or_init(|| {
            let mut database = Database::new();
            for face in BUNDLED_FACES {
                database.load_font_data(face.to_vec());
            }
            database.load_system_fonts();
            database.set_sans_serif_family(SANS_FAMILY);
            database.set_monospace_family(MONO_FAMILY);
            Arc::new(database)
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use usvg::fontdb::{Family, Query, Weight};

    use super::{MONO_FAMILY, SANS_FAMILY, font_database};

    #[test]
    fn bundled_faces_are_found_by_family_and_weight() {
        let database = font_database();
        for family in [SANS_FAMILY, MONO_FAMILY] {
            for weight in [Weight::NORMAL, Weight::SEMIBOLD] {
                let query = Query {
                    families: &[Family::Name(family)],
                    weight,
                    ..Query::default()
                };
                let id = database.query(&query);
                assert!(id.is_some(), "{family} {weight:?} must be bundled");
                let face = id.and_then(|id| database.face(id));
                assert_eq!(face.map(|face| face.weight), Some(weight));
            }
        }
    }
}
