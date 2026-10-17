import {
  ChevronRight,
  Database,
  DatabaseZap,
  Eye,
  EyeOff,
  Glasses,
  Search,
  SearchX,
  Table2,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { emptySchemaReason, listsEveryObject } from "@/features/schema/coverage";
import {
  countEntities,
  entityKey,
  entityListShape,
  filterEntityGroups,
  groupEntities,
  listEntities,
} from "@/features/schema/entities";
import type { EntityGroup, EntityKind, EntityListItem } from "@/features/schema/entities";
import type { Locale } from "@/shared/i18n/locales";
import type { MessageKey } from "@/shared/i18n/messages/en";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { classNames } from "@/shared/ui/classNames";

import styles from "./EntitiesSidebar.module.css";
import { setHidden } from "./canvasActions";
import { useCanvasUiStore } from "./canvasUiStore";
import { ENTITIES_SEARCH_INPUT_ID } from "./entitiesSearch";

interface EntitiesSidebarProps {
  /**
   * Notice shown above the search field, such as the partial-access bar. Passed in, so the
   * panel stays independent of the features that raise notices.
   */
  notice?: ReactNode;
}

const SECTION_LABELS: Record<EntityKind, MessageKey> = {
  table: "sidebar.section.tables",
  view: "sidebar.section.views",
};

/** Keys of the collapse state; a schema group and a kind section never share one. */
function schemaCollapseKey(schema: string): string {
  return `schema:${schema}`;
}

function sectionCollapseKey(schema: string, kind: EntityKind): string {
  return `${kind}:${schema}`;
}

function entitiesOf(group: EntityGroup): EntityListItem[] {
  return group.sections.flatMap((section) => section.entities);
}

/** "shown / total" once something is hidden, otherwise the total alone. */
function countLabel(
  entities: readonly EntityListItem[],
  hiddenKeys: ReadonlySet<string>,
  locale: Locale,
): string {
  const total = entities.length;
  const hidden = entities.filter((entity) => hiddenKeys.has(entity.key)).length;
  return hidden > 0
    ? `${(total - hidden).toLocaleString(locale)} / ${total.toLocaleString(locale)}`
    : total.toLocaleString(locale);
}

/** What every level of the list needs to draw its headers and rows. */
interface ListState {
  hiddenKeys: ReadonlySet<string>;
  selectedKeys: ReadonlySet<string>;
  locale: Locale;
  /** While a search runs every group and section is open and the toggles rest. */
  isSearching: boolean;
  isExpanded: (collapseKey: string) => boolean;
  onToggle: (collapseKey: string) => void;
}

/**
 * Lists the tables and views of the open project, searchable, grouped by schema and then by
 * kind. A level is shown only when it tells entities apart: one schema means no schema headers,
 * one kind no Tables and Views headers, decided on the whole list so the shape stays put while
 * typing. Groups and sections collapse for the session and all open while a search runs.
 * Clicking an entity centres it on the canvas; the eye toggles its visibility. When the login
 * could not see every object, the list ends with a note saying that others may exist.
 */
export function EntitiesSidebar({ notice }: EntitiesSidebarProps) {
  const { t, locale } = useI18n();
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const inspection = useProjectStore((state) => state.project?.content.inspection ?? null);
  const nodeStates = useProjectStore((state) => state.project?.content.canvas.nodes ?? null);
  const selectedKeys = useCanvasUiStore((state) => state.selectedKeys);
  const [query, setQuery] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const groups = useMemo(() => (snapshot ? groupEntities(listEntities(snapshot)) : []), [snapshot]);
  const shape = useMemo(() => entityListShape(groups), [groups]);
  const visibleGroups = useMemo(() => filterEntityGroups(groups, query), [groups, query]);
  const hiddenKeys = useMemo(
    () =>
      new Set(
        (nodeStates ?? []).filter((node) => node.isHidden).map((node) => entityKey(node.name)),
      ),
    [nodeStates],
  );
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const totalCount = countEntities(groups);
  const emptyReason =
    snapshot === null || inspection === null ? null : emptySchemaReason(snapshot, inspection);
  const showsNotVisibleFooter = snapshot !== null && !listsEveryObject(snapshot);
  // Collapsing is a way to focus; a search already does that, so everything opens meanwhile.
  const isSearching = query.trim() !== "";

  const list: ListState = {
    hiddenKeys,
    selectedKeys: selected,
    locale,
    isSearching,
    isExpanded: (collapseKey) => isSearching || !collapsedKeys.has(collapseKey),
    onToggle: (collapseKey) => {
      setCollapsedKeys((previous) => {
        const next = new Set(previous);
        if (!next.delete(collapseKey)) {
          next.add(collapseKey);
        }
        return next;
      });
    },
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span id={titleId} className={styles.title}>
          {t("sidebar.title")}
        </span>
        <span className={styles.count}>
          {hiddenKeys.size > 0
            ? `${(totalCount - hiddenKeys.size).toLocaleString(locale)} / ${totalCount.toLocaleString(locale)}`
            : totalCount.toLocaleString(locale)}
        </span>
      </div>
      {notice}
      <label className={styles.search}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input
          id={ENTITIES_SEARCH_INPUT_ID}
          type="search"
          className={styles.searchInput}
          placeholder={t("sidebar.search")}
          aria-label={t("sidebar.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          disabled={snapshot === null}
        />
      </label>
      <div className={styles.body}>
        {snapshot === null ? (
          <EmptyState
            icon={Database}
            title={t("sidebar.empty.title")}
            description={t("sidebar.empty.description")}
          />
        ) : emptyReason !== null ? (
          <EmptyState
            icon={DatabaseZap}
            title={
              emptyReason === "notVisible"
                ? t("sidebar.empty.notVisible.title")
                : t("sidebar.empty.database.title")
            }
            description={t(`sidebar.empty.${emptyReason}.description`, {
              database: snapshot.databaseName,
            })}
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyState icon={SearchX} title={t("sidebar.search.noMatches", { query })} />
        ) : shape.showsSchemas ? (
          <SchemaGroups
            groups={visibleGroups}
            showsKinds={shape.showsKinds}
            idPrefix={baseId}
            list={list}
          />
        ) : (
          // One schema: its sections, or its rows alone when only one kind exists.
          visibleGroups.map((group) =>
            shape.showsKinds ? (
              <KindSections
                key={group.schema}
                id={`${baseId}-sections`}
                labelledBy={titleId}
                group={group}
                nested={false}
                list={list}
              />
            ) : (
              <EntityList
                key={group.schema}
                id={`${baseId}-list`}
                labelledBy={titleId}
                entities={entitiesOf(group)}
                list={list}
              />
            ),
          )
        )}
        {showsNotVisibleFooter && emptyReason === null ? (
          <p className={styles.footer}>{t("sidebar.footer.notVisible")}</p>
        ) : null}
      </div>
    </div>
  );
}

interface SchemaGroupsProps {
  groups: readonly EntityGroup[];
  showsKinds: boolean;
  idPrefix: string;
  list: ListState;
}

/** One collapsible group per schema, each holding its kind sections or its rows alone. */
function SchemaGroups({ groups, showsKinds, idPrefix, list }: SchemaGroupsProps) {
  return (
    <ul className={styles.groups}>
      {groups.map((group, index) => {
        const collapseKey = schemaCollapseKey(group.schema);
        const isExpanded = list.isExpanded(collapseKey);
        const nameId = `${idPrefix}-schema${index}`;
        const contentId = `${nameId}-content`;
        const entities = entitiesOf(group);
        return (
          <li key={group.schema} className={styles.group}>
            <SectionHeader
              level="schema"
              nameId={nameId}
              controlsId={isExpanded ? contentId : undefined}
              name={group.schema}
              count={countLabel(entities, list.hiddenKeys, list.locale)}
              isExpanded={isExpanded}
              isLocked={list.isSearching}
              onToggle={() => {
                list.onToggle(collapseKey);
              }}
            />
            {!isExpanded ? null : showsKinds ? (
              <KindSections id={contentId} labelledBy={nameId} group={group} nested list={list} />
            ) : (
              <EntityList id={contentId} labelledBy={nameId} entities={entities} list={list} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface KindSectionsProps {
  id: string;
  labelledBy: string;
  group: EntityGroup;
  /** Inside a schema group the kind headers stick below the schema header. */
  nested: boolean;
  list: ListState;
}

/** The Tables and Views sections of one schema, each collapsible. */
function KindSections({ id, labelledBy, group, nested, list }: KindSectionsProps) {
  const { t } = useI18n();
  return (
    <ul id={id} className={styles.sections} aria-labelledby={labelledBy}>
      {group.sections.map((section) => {
        const collapseKey = sectionCollapseKey(group.schema, section.kind);
        const isExpanded = list.isExpanded(collapseKey);
        const nameId = `${id}-${section.kind}`;
        const listId = `${nameId}-list`;
        return (
          <li key={section.kind} className={classNames(styles.section, nested && styles.nested)}>
            <SectionHeader
              level="kind"
              nameId={nameId}
              controlsId={isExpanded ? listId : undefined}
              name={t(SECTION_LABELS[section.kind])}
              count={countLabel(section.entities, list.hiddenKeys, list.locale)}
              isExpanded={isExpanded}
              isLocked={list.isSearching}
              onToggle={() => {
                list.onToggle(collapseKey);
              }}
            />
            {isExpanded ? (
              <EntityList id={listId} labelledBy={nameId} entities={section.entities} list={list} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface SectionHeaderProps {
  level: "schema" | "kind";
  /** Id of the name, which labels the list the header opens. */
  nameId: string;
  /** Id of the list the header controls, while that list is shown. */
  controlsId?: string;
  name: string;
  count: string;
  isExpanded: boolean;
  /** A locked header stays open and its toggle rests, as during a search. */
  isLocked: boolean;
  onToggle: () => void;
}

/** Sticky, collapsible heading of a schema group or a kind section, with its count. */
function SectionHeader({
  level,
  nameId,
  controlsId,
  name,
  count,
  isExpanded,
  isLocked,
  onToggle,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      className={classNames(
        styles.sectionHeader,
        level === "schema" ? styles.schemaHeader : styles.kindHeader,
      )}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      disabled={isLocked}
      onClick={onToggle}
    >
      <ChevronRight
        className={classNames(styles.chevron, isExpanded && styles.chevronOpen)}
        aria-hidden="true"
      />
      <span id={nameId} className={styles.sectionName}>
        {name}
      </span>
      <span className={styles.sectionCount}>{count}</span>
    </button>
  );
}

interface EntityListProps {
  id: string;
  labelledBy: string;
  entities: readonly EntityListItem[];
  list: ListState;
}

function EntityList({ id, labelledBy, entities, list }: EntityListProps) {
  return (
    <ul id={id} className={styles.entities} aria-labelledby={labelledBy}>
      {entities.map((entity) => (
        <EntityRow
          key={entity.key}
          entity={entity}
          isHidden={list.hiddenKeys.has(entity.key)}
          isSelected={list.selectedKeys.has(entity.key)}
        />
      ))}
    </ul>
  );
}

interface EntityRowProps {
  entity: EntityListItem;
  isHidden: boolean;
  isSelected: boolean;
}

/**
 * One table or view: centre on click, the Inspector on double-click, the context menu on right
 * click, the eye to hide.
 */
function EntityRow({ entity, isHidden, isSelected }: EntityRowProps) {
  const { t, tCount } = useI18n();
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const openInspector = useCanvasUiStore((state) => state.openInspector);
  const openContextMenu = useCanvasUiStore((state) => state.openContextMenu);
  const isView = entity.kind === "view";
  const KindIcon = isView ? Glasses : Table2;

  return (
    <li
      className={classNames(
        styles.entity,
        isHidden && styles.entityHidden,
        isSelected && styles.entitySelected,
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ key: entity.key, x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className={styles.entityButton}
        title={entity.key}
        aria-label={t("sidebar.center", { name: entity.key })}
        onClick={() => {
          focusEntity(entity.key);
        }}
        onDoubleClick={() => {
          // The first click selected the entity; a hidden one has no card, so nothing to show.
          if (!isHidden) {
            openInspector();
          }
        }}
      >
        <KindIcon
          className={classNames(styles.entityIcon, isView && styles.viewIcon)}
          aria-hidden="true"
        />
        <span className={styles.entityName}>{entity.name}</span>
        <span
          className={styles.entityColumns}
          aria-label={tCount("entity.columns", entity.columnCount)}
        >
          {entity.columnCount}
        </span>
      </button>
      <button
        type="button"
        className={styles.visibility}
        aria-label={
          isHidden
            ? t("sidebar.show", { name: entity.key })
            : t("sidebar.hide", { name: entity.key })
        }
        aria-pressed={!isHidden}
        onClick={() => {
          setHidden([entity.key], !isHidden);
        }}
      >
        {isHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </li>
  );
}
