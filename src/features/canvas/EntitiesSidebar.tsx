import {
  ChevronRight,
  Database,
  DatabaseZap,
  Eye,
  EyeOff,
  Glasses,
  Lock,
  ScrollText,
  Search,
  SearchX,
  SquareFunction,
  Table2,
} from "lucide-react";
import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { activeCanvas } from "@/features/perspectives/perspectiveState";
import {
  emptySchemaReason,
  listsEveryObject,
  routinesListNotice,
} from "@/features/schema/coverage";
import { entityKey, qualifiedNameLabel } from "@/features/schema/entities";
import type { EntityListItem } from "@/features/schema/entities";
import { moduleKey } from "@/features/schema/modules";
import { presentRoutineDependencyTracking } from "@/features/schema/routineDependencyTracking";
import {
  OBJECT_PAGE_SIZE,
  OBJECT_SEARCH_LIMIT,
  countObjects,
  groupObjects,
  isEntityItem,
  listObjects,
  objectListShape,
  objectPage,
  searchObjectGroups,
} from "@/features/schema/objects";
import type {
  ObjectGroup,
  ObjectKind,
  ObjectListItem,
  RoutineListItem,
} from "@/features/schema/objects";
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

const SECTION_LABELS: Record<ObjectKind, MessageKey> = {
  table: "sidebar.section.tables",
  view: "sidebar.section.views",
  procedure: "objects.section.procedures",
  function: "objects.section.functions",
  unknown: "objects.section.unknown",
};

/** Keys of the collapse state; a schema group and a kind section never share one. */
function schemaCollapseKey(schema: string): string {
  return `schema:${schema}`;
}

function sectionCollapseKey(schema: string, kind: ObjectKind): string {
  return `${kind}:${schema}`;
}

function objectsOf(group: ObjectGroup): ObjectListItem[] {
  return group.sections.flatMap((section) => section.objects);
}

/** "shown / total" once something is hidden, otherwise the total alone. */
function countLabel(
  objects: readonly ObjectListItem[],
  hiddenKeys: ReadonlySet<string>,
  locale: Locale,
): string {
  const total = objects.length;
  const hidden = objects.filter((item) => isEntityItem(item) && hiddenKeys.has(item.key)).length;
  return hidden > 0
    ? `${(total - hidden).toLocaleString(locale)} / ${total.toLocaleString(locale)}`
    : total.toLocaleString(locale);
}

/** What every level of the list needs to draw its headers and rows. */
interface ListState {
  hiddenKeys: ReadonlySet<string>;
  selectedKeys: ReadonlySet<string>;
  selectedModuleKey: string | null;
  locale: Locale;
  /** While a search runs every group and section is open and the toggles rest. */
  isSearching: boolean;
  isExpanded: (collapseKey: string, initiallyCollapsed?: boolean) => boolean;
  onToggle: (collapseKey: string, initiallyCollapsed?: boolean) => void;
}

/**
 * Lists the objects of the open project, searchable, grouped by schema and then by
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
  const nodeStates = useProjectStore((state) =>
    state.project === null ? null : activeCanvas(state.project.content).nodes,
  );
  const selectedKeys = useCanvasUiStore((state) => state.selectedKeys);
  const selectedModule = useCanvasUiStore((state) => state.selectedModule);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const groups = useMemo(() => (snapshot ? groupObjects(listObjects(snapshot)) : []), [snapshot]);
  const shape = useMemo(() => objectListShape(groups), [groups]);
  const search = useMemo(() => searchObjectGroups(groups, deferredQuery), [groups, deferredQuery]);
  const visibleGroups = search.groups;
  const hiddenKeys = useMemo(
    () =>
      new Set(
        (nodeStates ?? []).filter((node) => node.isHidden).map((node) => entityKey(node.name)),
      ),
    [nodeStates],
  );
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const totalCount = countObjects(groups);
  const emptyReason =
    snapshot === null || inspection === null ? null : emptySchemaReason(snapshot, inspection);
  const showsNotVisibleFooter = snapshot !== null && !listsEveryObject(snapshot);
  const routinesNotice = snapshot === null ? null : routinesListNotice(snapshot);
  // Collapsing is a way to focus; a search already does that, so everything opens meanwhile.
  const isSearching = deferredQuery.trim() !== "";

  const list = useMemo<ListState>(
    () => ({
      hiddenKeys,
      selectedKeys: selected,
      selectedModuleKey: selectedModule === null ? null : moduleKey(selectedModule),
      locale,
      isSearching,
      isExpanded: (collapseKey, initiallyCollapsed = false) =>
        isSearching || (expandedGroups.get(collapseKey) ?? !initiallyCollapsed),
      onToggle: (collapseKey, initiallyCollapsed = false) => {
        setExpandedGroups((previous) => {
          const next = new Map(previous);
          next.set(collapseKey, !(previous.get(collapseKey) ?? !initiallyCollapsed));
          return next;
        });
      },
    }),
    [hiddenKeys, selected, selectedModule, locale, isSearching, expandedGroups],
  );

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
          data-object-search="true"
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
      <div className={styles.body} aria-busy={query !== deferredQuery}>
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
          <EmptyState
            icon={SearchX}
            title={t("sidebar.search.noMatches", { query: deferredQuery })}
          />
        ) : (
          <GroupedObjects
            groups={visibleGroups}
            shape={shape}
            idPrefix={baseId}
            titleId={titleId}
            list={list}
          />
        )}
        {search.isLimited ? (
          <p className={styles.footer}>
            {t("objects.search.limited", {
              count: OBJECT_SEARCH_LIMIT,
              total: search.totalMatches,
            })}
          </p>
        ) : null}
        {showsNotVisibleFooter && emptyReason === null ? (
          <p className={styles.footer}>{t("sidebar.footer.notVisible")}</p>
        ) : null}
        {routinesNotice !== null ? (
          <p className={styles.footer}>{t(`objects.footer.${routinesNotice}`)}</p>
        ) : null}
      </div>
    </div>
  );
}

interface GroupedObjectsProps {
  groups: readonly ObjectGroup[];
  shape: ReturnType<typeof objectListShape>;
  idPrefix: string;
  titleId: string;
  list: ListState;
}

/** Urgent input updates leave the old rows alone until the deferred search is ready. */
const GroupedObjects = memo(function GroupedObjects({
  groups,
  shape,
  idPrefix,
  titleId,
  list,
}: GroupedObjectsProps) {
  if (shape.showsSchemas) {
    return (
      <SchemaGroups groups={groups} showsKinds={shape.showsKinds} idPrefix={idPrefix} list={list} />
    );
  }
  // One schema: its sections, or its rows alone when only one kind exists.
  return groups.map((group) =>
    shape.showsKinds ? (
      <KindSections
        key={group.schema}
        id={`${idPrefix}-sections`}
        labelledBy={titleId}
        group={group}
        nested={false}
        list={list}
      />
    ) : (
      <ObjectList
        key={group.schema}
        id={`${idPrefix}-list`}
        labelledBy={titleId}
        objects={objectsOf(group)}
        list={list}
      />
    ),
  );
});

interface SchemaGroupsProps {
  groups: readonly ObjectGroup[];
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
        const objects = objectsOf(group);
        return (
          <li key={group.schema} className={styles.group}>
            <SectionHeader
              level="schema"
              nameId={nameId}
              controlsId={isExpanded ? contentId : undefined}
              name={group.schema}
              count={countLabel(objects, list.hiddenKeys, list.locale)}
              isExpanded={isExpanded}
              isLocked={list.isSearching}
              onToggle={() => {
                list.onToggle(collapseKey);
              }}
            />
            {!isExpanded ? null : showsKinds ? (
              <KindSections id={contentId} labelledBy={nameId} group={group} nested list={list} />
            ) : (
              <ObjectList id={contentId} labelledBy={nameId} objects={objects} list={list} />
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
  group: ObjectGroup;
  /** Inside a schema group the kind headers stick below the schema header. */
  nested: boolean;
  list: ListState;
}

/** Tables and views start open; routine sections start collapsed for the session. */
function KindSections({ id, labelledBy, group, nested, list }: KindSectionsProps) {
  const { t } = useI18n();
  return (
    <ul id={id} className={styles.sections} aria-labelledby={labelledBy}>
      {group.sections.map((section) => {
        const collapseKey = sectionCollapseKey(group.schema, section.kind);
        const initiallyCollapsed = section.kind !== "table" && section.kind !== "view";
        const isExpanded = list.isExpanded(collapseKey, initiallyCollapsed);
        const nameId = `${id}-${section.kind}`;
        const listId = `${nameId}-list`;
        return (
          <li key={section.kind} className={classNames(styles.section, nested && styles.nested)}>
            <SectionHeader
              level="kind"
              nameId={nameId}
              controlsId={isExpanded ? listId : undefined}
              name={t(SECTION_LABELS[section.kind])}
              count={countLabel(section.objects, list.hiddenKeys, list.locale)}
              isExpanded={isExpanded}
              isLocked={list.isSearching}
              onToggle={() => {
                list.onToggle(collapseKey, initiallyCollapsed);
              }}
            />
            {isExpanded ? (
              <ObjectList id={listId} labelledBy={nameId} objects={section.objects} list={list} />
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

interface ObjectListProps {
  id: string;
  labelledBy: string;
  objects: readonly ObjectListItem[];
  list: ListState;
}

function ObjectList({ id, labelledBy, objects, list }: ObjectListProps) {
  const { t } = useI18n();
  const [pages, setPages] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);
  const firstNewRow = useRef<number | null>(null);
  const visible = list.isSearching ? objects : objectPage(objects, pages);
  const remaining = objects.length - visible.length;

  useEffect(() => {
    if (firstNewRow.current === null) return;
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-object-index="${firstNewRow.current}"] > button`)
      ?.focus();
    firstNewRow.current = null;
  }, [pages]);

  return (
    <ul id={id} className={styles.entities} aria-labelledby={labelledBy} ref={listRef}>
      {visible.map((item, index) =>
        isEntityItem(item) ? (
          <EntityRow
            key={item.key}
            entity={item}
            index={index}
            isHidden={list.hiddenKeys.has(item.key)}
            isSelected={list.selectedKeys.has(item.key)}
          />
        ) : (
          <RoutineRow
            key={item.key}
            routine={item}
            index={index}
            isSelected={list.selectedModuleKey === item.key}
          />
        ),
      )}
      {remaining > 0 ? (
        <li>
          <button
            type="button"
            className={styles.showMore}
            onClick={() => {
              firstNewRow.current = visible.length;
              setPages((previous) => previous + 1);
            }}
          >
            {t("objects.showMore", { count: Math.min(OBJECT_PAGE_SIZE, remaining), remaining })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

interface EntityRowProps {
  entity: EntityListItem;
  isHidden: boolean;
  isSelected: boolean;
  index: number;
}

/**
 * One table or view: centre on click, the Inspector on double-click, the context menu on right
 * click, the eye to hide.
 */
function EntityRow({ entity, isHidden, isSelected, index }: EntityRowProps) {
  const { t, tCount } = useI18n();
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const openInspector = useCanvasUiStore((state) => state.openInspector);
  const openContextMenu = useCanvasUiStore((state) => state.openContextMenu);
  const isView = entity.kind === "view";
  const KindIcon = isView ? Glasses : Table2;

  return (
    <li
      data-object-index={index}
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
        title={qualifiedNameLabel(entity)}
        aria-label={t("sidebar.center", { name: qualifiedNameLabel(entity) })}
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
            ? t("sidebar.show", { name: qualifiedNameLabel(entity) })
            : t("sidebar.hide", { name: qualifiedNameLabel(entity) })
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

interface RoutineRowProps {
  routine: RoutineListItem;
  isSelected: boolean;
  index: number;
}

/** A routine is inspected, never hidden on the diagram or offered an entity context menu. */
export function RoutineRow({ routine, isSelected, index }: RoutineRowProps) {
  const translator = useI18n();
  const { t, tCount } = translator;
  const tracking =
    routine.routineBodyTracking === undefined
      ? null
      : presentRoutineDependencyTracking(routine.routineBodyTracking, translator);
  const selectModule = useCanvasUiStore((state) => state.selectModule);
  const Icon = routine.kind === "function" ? SquareFunction : ScrollText;
  const name = qualifiedNameLabel(routine.ref.name);
  const parameters = tCount("objects.parameters", routine.parameterCount);
  return (
    <li
      data-object-index={index}
      className={classNames(styles.entity, isSelected && styles.entitySelected)}
    >
      <button
        type="button"
        className={styles.entityButton}
        data-module-key={moduleKey(routine.ref)}
        title={name}
        aria-label={t("objects.details", { name })}
        onClick={(event) => {
          selectModule(routine.ref, { focus: event.detail === 0 });
        }}
      >
        <Icon className={styles.entityIcon} aria-hidden="true" />
        <span className={styles.entityName}>{routine.name}</span>
        <span className={styles.entityColumns} title={parameters} aria-label={parameters}>
          {routine.parameterCount}
        </span>
        {tracking === null ? null : (
          <span
            className={styles.trackingMark}
            title={`${tracking.title}: ${tracking.label}. ${tracking.explanation}`}
            aria-label={`${tracking.title}: ${tracking.label}. ${tracking.explanation}`}
          >
            {tracking.label}
          </span>
        )}
        {routine.isEncrypted ? (
          <Lock className={styles.entityIcon} aria-label={t("objects.encrypted")}>
            <title>{t("objects.encrypted")}</title>
          </Lock>
        ) : routine.implementation === "clr" ? (
          <span className={styles.moduleMark}>{t("objects.clr")}</span>
        ) : null}
      </button>
    </li>
  );
}
