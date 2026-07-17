/**
 * features/evaluator/contexts/EvaluatorStateContext.tsx
 * ---------------------------------------------------------------------------
 * Runtime state for the Evaluator Dashboard (D6). Replaces the reference
 * mockup's two demo *props* (`exState`, `projector`) with real React state,
 * plus every other piece of interaction state the mockup kept in
 * `class Component extends DCLogic { state = {...} }` (view, replay
 * transport, timeline filters, annotation capture, coverage confirmation,
 * AAR export progress).
 *
 * `exerciseState` models the exercise's real lifecycle phase:
 *   - 'live-quiet' / 'live-storm' — conduct is running, storm = burst load
 *   - 'hotwash'                   — post-EndEx, projector-facing review
 *   - 'pre-e8'                    — ran without the adaptive engine (E8)
 * TODO(E1): source `exerciseState` from the real exercise-context/lifecycle
 * API (COR-032/050) instead of the dev-only toggle strip below.
 * TODO(XC-004): once a telemetry stream exists, playhead/live-stream/tile
 * data should react to it; today everything is derived from the mock
 * fixtures in `services/mockData.ts` + `services/stageContent.ts`.
 *
 * Keyboard shortcuts (D6-003, D6-005): B opens the annotation popover
 * anywhere; 1/2/3 pick its category while open; Enter saves; Esc cancels
 * (and closes flyouts); Space toggles replay playback while the Replay view
 * is active. All are wired here so every component gets them for free.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type {
  Annotation,
  AnnotationCategory,
  CoverageItem,
  ExerciseState,
  EvaluatorView,
  PlaybackSpeed,
  ReplayMode,
  TimelineFilters,
  WorldChannel,
} from '../types'
import { ARC_DURATION_MINUTES, TIME_JUMP_T, scenarioClock } from '../services/scenarioTime'
import { INITIAL_ANNOTATIONS, INITIAL_COVERAGE_ITEMS } from '../services/mockData'

// ---------------------------------------------------------------------------
// State shape + reducer
// ---------------------------------------------------------------------------

interface State {
  exerciseState: ExerciseState;
  projector: boolean;

  view: EvaluatorView | null;
  replayMode: ReplayMode | null;

  worldChannel: WorldChannel;
  replayChannel: WorldChannel;

  playhead: number;
  playing: boolean;
  speed: PlaybackSpeed;
  toastAt: number | null;

  timelineFilters: TimelineFilters;

  annotationPopoverOpen: boolean;
  annotationNote: string;
  annotationCategory: AnnotationCategory;
  annotationAnchor: string;
  annotations: Annotation[];

  coverageItems: CoverageItem[];

  exporting: boolean;
  exportPct: number;
  exportDone: boolean;
}

const initialTimelineFilters: TimelineFilters = {
  channel: 'All',
  origin: 'All',
  storyline: 'All',
  range: 'All',
  actorQuery: '',
}

const initialState: State = {
  exerciseState: 'live-quiet',
  projector: false,

  view: null,
  replayMode: null,

  worldChannel: 'portal',
  replayChannel: 'portal',

  playhead: 44,
  playing: false,
  speed: 4,
  toastAt: null,

  timelineFilters: initialTimelineFilters,

  annotationPopoverOpen: false,
  annotationNote: '',
  annotationCategory: 'OBSERVATION',
  annotationAnchor: '',
  annotations: INITIAL_ANNOTATIONS,

  coverageItems: INITIAL_COVERAGE_ITEMS,

  exporting: false,
  exportPct: 0,
  exportDone: false,
}

type Action =
  | { type: 'SET_EXERCISE_STATE_DEV'; state: ExerciseState }
  | { type: 'SET_PROJECTOR_DEV'; on: boolean }
  | { type: 'SET_VIEW'; view: EvaluatorView }
  | { type: 'FILTER_TIMELINE_BY_STORYLINE'; storyline: string }
  | { type: 'SET_REPLAY_MODE'; mode: ReplayMode }
  | { type: 'SET_WORLD_CHANNEL'; channel: WorldChannel }
  | { type: 'SET_REPLAY_CHANNEL'; channel: WorldChannel }
  | { type: 'SCRUB_TO'; t: number }
  | { type: 'JUMP_TO_REPLAY_MOMENT'; t: number; channel: WorldChannel }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'STOP_PLAY' }
  | { type: 'TICK' }
  | { type: 'SET_SPEED'; speed: PlaybackSpeed }
  | { type: 'CLEAR_TOAST' }
  | { type: 'SET_TIMELINE_FILTER'; key: keyof TimelineFilters; value: string }
  | { type: 'OPEN_ANNOTATION'; anchor: string }
  | { type: 'CLOSE_ANNOTATION' }
  | { type: 'SET_ANNOTATION_NOTE'; note: string }
  | { type: 'SET_ANNOTATION_CATEGORY'; category: AnnotationCategory }
  | { type: 'SAVE_ANNOTATION'; time: string }
  | { type: 'PUSH_ANNOTATION'; id: string }
  | { type: 'PUSH_ALL_ANNOTATIONS' }
  | { type: 'CONFIRM_COVERAGE'; id: string; evaluatorId: string }
  | { type: 'DISMISS_COVERAGE'; id: string }
  | { type: 'START_EXPORT' }
  | { type: 'EXPORT_TICK' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_EXERCISE_STATE_DEV':
      // Dev-only: flipping exercise state resets view/replay-mode back to the
      // derived default for that state (mirrors the mockup's curView()).
      return { ...state, exerciseState: action.state, view: null, replayMode: null }
    case 'SET_PROJECTOR_DEV':
      return { ...state, projector: action.on }
    case 'SET_VIEW':
      return { ...state, view: action.view }
    case 'FILTER_TIMELINE_BY_STORYLINE':
      return {
        ...state,
        view: 'timeline',
        timelineFilters: { ...state.timelineFilters, storyline: action.storyline },
      }
    case 'SET_REPLAY_MODE':
      return { ...state, replayMode: action.mode }
    case 'SET_WORLD_CHANNEL':
      return { ...state, worldChannel: action.channel }
    case 'SET_REPLAY_CHANNEL':
      return { ...state, replayChannel: action.channel }
    case 'SCRUB_TO':
      return {
        ...state,
        playhead: Math.max(0, Math.min(ARC_DURATION_MINUTES, action.t)),
        playing: false,
      }
    case 'JUMP_TO_REPLAY_MOMENT':
      return {
        ...state,
        view: 'replay',
        playhead: Math.max(0, Math.min(ARC_DURATION_MINUTES, action.t)),
        replayChannel: action.channel,
        playing: false,
      }
    case 'TOGGLE_PLAY':
      return { ...state, playing: !state.playing }
    case 'STOP_PLAY':
      return { ...state, playing: false }
    case 'TICK': {
      const step = state.speed * 0.05
      const t = state.playhead + step
      const crossedSeam = state.playhead < TIME_JUMP_T && t >= TIME_JUMP_T
      const toastAt = crossedSeam ? Date.now() : state.toastAt
      if (t >= ARC_DURATION_MINUTES) {
        return { ...state, playhead: ARC_DURATION_MINUTES, playing: false, toastAt }
      }
      return { ...state, playhead: t, toastAt }
    }
    case 'SET_SPEED':
      return { ...state, speed: action.speed }
    case 'CLEAR_TOAST':
      return { ...state, toastAt: null }
    case 'SET_TIMELINE_FILTER': {
      const merged = { ...state.timelineFilters, [action.key]: action.value }
      return { ...state, timelineFilters: merged as TimelineFilters }
    }
    case 'OPEN_ANNOTATION':
      return {
        ...state,
        annotationPopoverOpen: true,
        annotationNote: '',
        annotationCategory: 'OBSERVATION',
        annotationAnchor: action.anchor,
      }
    case 'CLOSE_ANNOTATION':
      return { ...state, annotationPopoverOpen: false }
    case 'SET_ANNOTATION_NOTE':
      return { ...state, annotationNote: action.note }
    case 'SET_ANNOTATION_CATEGORY':
      return { ...state, annotationCategory: action.category }
    case 'SAVE_ANNOTATION': {
      if (!state.annotationNote.trim()) return { ...state, annotationPopoverOpen: false }
      const newAnnotation: Annotation = {
        id: `anno-${Date.now()}`,
        time: action.time,
        category: state.annotationCategory,
        note: state.annotationNote.trim(),
        anchor: state.annotationAnchor,
        pushed: false,
      }
      return {
        ...state,
        annotationPopoverOpen: false,
        annotations: [newAnnotation, ...state.annotations],
      }
    }
    case 'PUSH_ANNOTATION':
      return {
        ...state,
        annotations: state.annotations.map(a => (a.id === action.id ? { ...a, pushed: true } : a)),
      }
    case 'PUSH_ALL_ANNOTATIONS':
      return { ...state, annotations: state.annotations.map(a => ({ ...a, pushed: true })) }
    case 'CONFIRM_COVERAGE':
      return {
        ...state,
        coverageItems: state.coverageItems.map(c => (
          c.id === action.id ? { ...c, status: 'confirmed', confirmedBy: action.evaluatorId } : c
        )),
      }
    case 'DISMISS_COVERAGE':
      return { ...state, coverageItems: state.coverageItems.filter(c => c.id !== action.id) }
    case 'START_EXPORT':
      if (state.exporting) return state
      return { ...state, exporting: true, exportDone: false, exportPct: 0 }
    case 'EXPORT_TICK': {
      if (state.exportPct >= 100) return { ...state, exporting: false, exportDone: true }
      return { ...state, exportPct: Math.min(100, state.exportPct + 12) }
    }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface EvaluatorStateValue {
  // Exercise / demo state (DEV-only controls; see D6 instructions + TODO above)
  exerciseState: ExerciseState;
  projector: boolean;
  isStorm: boolean;
  engineOn: boolean;
  engineOff: boolean;
  isHotwashExercise: boolean;
  /** "Now", in elapsed scenario minutes — 50 during a storm, 44 otherwise. */
  nowT: number;
  setExerciseStateDev: (state: ExerciseState) => void;
  setProjectorDev: (on: boolean) => void;

  // Navigation
  view: EvaluatorView;
  setView: (view: EvaluatorView) => void;
  filterTimelineByStoryline: (storylineName: string) => void;

  replayMode: ReplayMode;
  setReplayMode: (mode: ReplayMode) => void;

  worldChannel: WorldChannel;
  setWorldChannel: (channel: WorldChannel) => void;
  replayChannel: WorldChannel;
  setReplayChannel: (channel: WorldChannel) => void;

  // Replay transport
  playhead: number;
  playing: boolean;
  speed: PlaybackSpeed;
  togglePlay: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  scrubTo: (t: number) => void;
  jumpToReplayMoment: (t: number, channel: WorldChannel) => void;
  showScenarioAdvancedToast: boolean;

  // Timeline filters
  timelineFilters: TimelineFilters;
  setTimelineFilter: (key: keyof TimelineFilters, value: string) => void;

  // Annotation capture (D6-003)
  annotations: Annotation[];
  annotationPopoverOpen: boolean;
  annotationNote: string;
  annotationCategory: AnnotationCategory;
  annotationAnchor: string;
  openAnnotation: (anchor?: string) => void;
  closeAnnotation: () => void;
  setAnnotationNote: (note: string) => void;
  setAnnotationCategory: (category: AnnotationCategory) => void;
  saveAnnotation: () => void;
  pushAnnotation: (id: string) => void;
  pushAllAnnotations: () => void;

  // Coverage (D6-010)
  coverageItems: CoverageItem[];
  confirmCoverage: (id: string) => void;
  dismissCoverage: (id: string) => void;

  // AAR export (D6-012)
  exporting: boolean;
  exportPct: number;
  exportDone: boolean;
  startExport: () => void;
}

const EvaluatorStateContext = createContext<EvaluatorStateValue | null>(null)

/** Demo evaluator identity — TODO(E1): source from the signed-in staff session. */
const CURRENT_EVALUATOR_ID = 'E1'

interface EvaluatorStateProviderProps {
  children: ReactNode;
}

export function EvaluatorStateProvider({ children }: EvaluatorStateProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Stable ref to current state for the keydown listener (registered once).
  // Updated in an effect, never during render (refs aren't render inputs).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const isStorm = state.exerciseState === 'live-storm'
  const engineOff = state.exerciseState === 'pre-e8'
  const isHotwashExercise = state.exerciseState === 'hotwash'
  const nowT = isStorm ? 50 : 44

  const view: EvaluatorView = state.view ?? (isHotwashExercise ? 'replay' : 'live')
  const replayMode: ReplayMode = state.replayMode ?? (isHotwashExercise ? 'hotwash' : 'eval')

  const showScenarioAdvancedToast = state.toastAt !== null

  // Auto-clear the "SCENARIO TIME ADVANCED" toast ~2.6s after it's raised.
  useEffect(() => {
    if (state.toastAt === null) return
    const timeout = window.setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 2600)
    return () => window.clearTimeout(timeout)
  }, [state.toastAt])

  // Replay playback ticker.
  useEffect(() => {
    if (!state.playing) return
    const interval = window.setInterval(() => dispatch({ type: 'TICK' }), 120)
    return () => window.clearInterval(interval)
  }, [state.playing])

  // AAR export progress ticker.
  useEffect(() => {
    if (!state.exporting) return
    const interval = window.setInterval(() => dispatch({ type: 'EXPORT_TICK' }), 220)
    return () => window.clearInterval(interval)
  }, [state.exporting])

  const contextAnchor = useCallback((): string => {
    const s = stateRef.current
    const currentView: EvaluatorView = s.view ?? (s.exerciseState === 'hotwash' ? 'replay' : 'live')
    const currentNowT = s.exerciseState === 'live-storm' ? 50 : 44
    if (currentView === 'replay') return `Replay · ${scenarioClock(s.playhead)} scenario`
    if (currentView === 'timeline') return `Timeline view · ${scenarioClock(currentNowT)}`
    if (currentView === 'metrics') return 'Metrics view'
    return `Live dashboard · ${scenarioClock(currentNowT)}`
  }, [])

  const openAnnotation = useCallback((anchor?: string) => {
    dispatch({ type: 'OPEN_ANNOTATION', anchor: anchor ?? contextAnchor() })
  }, [contextAnchor])

  const saveAnnotation = useCallback(() => {
    const s = stateRef.current
    const currentView: EvaluatorView = s.view ?? (s.exerciseState === 'hotwash' ? 'replay' : 'live')
    const currentNowT = s.exerciseState === 'live-storm' ? 50 : 44
    const time = scenarioClock(currentView === 'replay' ? s.playhead : currentNowT)
    dispatch({ type: 'SAVE_ANNOTATION', time })
  }, [])

  // Global keyboard shortcuts (D6-003, D6-005): B / 1-2-3 / Enter / Esc / Space.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toUpperCase()
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_ANNOTATION' })
        return
      }
      if (typing) return

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        openAnnotation()
        return
      }
      if (stateRef.current.annotationPopoverOpen && ['1', '2', '3'].includes(e.key)) {
        const categories: AnnotationCategory[] = ['STRENGTH', 'IMPROVEMENT', 'OBSERVATION']
        const category = categories[Number(e.key) - 1]
        if (category) dispatch({ type: 'SET_ANNOTATION_CATEGORY', category })
        return
      }
      const currentView: EvaluatorView = stateRef.current.view
        ?? (stateRef.current.exerciseState === 'hotwash' ? 'replay' : 'live')
      if (e.key === ' ' && currentView === 'replay') {
        e.preventDefault()
        dispatch({ type: 'TOGGLE_PLAY' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openAnnotation])

  const value = useMemo<EvaluatorStateValue>(() => ({
    exerciseState: state.exerciseState,
    projector: state.projector,
    isStorm,
    engineOn: !engineOff,
    engineOff,
    isHotwashExercise,
    nowT,
    setExerciseStateDev: exState => dispatch({ type: 'SET_EXERCISE_STATE_DEV', state: exState }),
    setProjectorDev: on => dispatch({ type: 'SET_PROJECTOR_DEV', on }),

    view,
    setView: v => dispatch({ type: 'SET_VIEW', view: v }),
    filterTimelineByStoryline: storyline => dispatch({ type: 'FILTER_TIMELINE_BY_STORYLINE', storyline }),

    replayMode,
    setReplayMode: mode => dispatch({ type: 'SET_REPLAY_MODE', mode }),

    worldChannel: state.worldChannel,
    setWorldChannel: channel => dispatch({ type: 'SET_WORLD_CHANNEL', channel }),
    replayChannel: state.replayChannel,
    setReplayChannel: channel => dispatch({ type: 'SET_REPLAY_CHANNEL', channel }),

    playhead: state.playhead,
    playing: state.playing,
    speed: state.speed,
    togglePlay: () => dispatch({ type: 'TOGGLE_PLAY' }),
    setSpeed: speed => dispatch({ type: 'SET_SPEED', speed }),
    scrubTo: t => dispatch({ type: 'SCRUB_TO', t }),
    jumpToReplayMoment: (t, channel) => dispatch({ type: 'JUMP_TO_REPLAY_MOMENT', t, channel }),
    showScenarioAdvancedToast,

    timelineFilters: state.timelineFilters,
    setTimelineFilter: (key, val) => dispatch({ type: 'SET_TIMELINE_FILTER', key, value: val }),

    annotations: state.annotations,
    annotationPopoverOpen: state.annotationPopoverOpen,
    annotationNote: state.annotationNote,
    annotationCategory: state.annotationCategory,
    annotationAnchor: state.annotationAnchor,
    openAnnotation,
    closeAnnotation: () => dispatch({ type: 'CLOSE_ANNOTATION' }),
    setAnnotationNote: note => dispatch({ type: 'SET_ANNOTATION_NOTE', note }),
    setAnnotationCategory: category => dispatch({ type: 'SET_ANNOTATION_CATEGORY', category }),
    saveAnnotation,
    pushAnnotation: id => dispatch({ type: 'PUSH_ANNOTATION', id }),
    pushAllAnnotations: () => dispatch({ type: 'PUSH_ALL_ANNOTATIONS' }),

    coverageItems: state.coverageItems,
    confirmCoverage: id => dispatch({ type: 'CONFIRM_COVERAGE', id, evaluatorId: CURRENT_EVALUATOR_ID }),
    dismissCoverage: id => dispatch({ type: 'DISMISS_COVERAGE', id }),

    exporting: state.exporting,
    exportPct: state.exportPct,
    exportDone: state.exportDone,
    startExport: () => dispatch({ type: 'START_EXPORT' }),
  }), [
    state, isStorm, engineOff, isHotwashExercise, nowT, view, replayMode,
    showScenarioAdvancedToast, openAnnotation, saveAnnotation,
  ])

  return (
    <EvaluatorStateContext.Provider value={value}>
      {children}
    </EvaluatorStateContext.Provider>
  )
}

export function useEvaluatorState(): EvaluatorStateValue {
  const ctx = useContext(EvaluatorStateContext)
  if (!ctx) {
    throw new Error('useEvaluatorState must be used within an EvaluatorStateProvider')
  }
  return ctx
}
