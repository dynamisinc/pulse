/**
 * features/evaluator/components/AnnotationCapture.tsx
 * ---------------------------------------------------------------------------
 * The ≤10s annotation-capture popover (D6-003, EVL-020): opens on B or any
 * ⚑, no modal, anchored to whatever the evaluator was looking at. Category
 * chips STRENGTH/IMPROVEMENT/OBSERVATION select on keys 1/2/3; Enter saves,
 * Esc cancels — both shortcuts are wired centrally in
 * `EvaluatorStateContext` so they work regardless of what has focus.
 */

import { Box, Stack, Typography, Chip, Button } from '@mui/material'
import type { KeyboardEvent } from 'react'
import { CobraTextField } from '@/theme/styledComponents'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import type { AnnotationCategory } from '../types'

interface CategoryOption {
  category: AnnotationCategory;
  key: string;
  colors: { border: string; bg: string; fg: string };
}

const CATEGORIES: CategoryOption[] = [
  { category: 'STRENGTH', key: '1', colors: { border: '#256b43', bg: '#eef7f0', fg: '#256b43' } },
  { category: 'IMPROVEMENT', key: '2', colors: { border: '#8a5300', bg: '#fdf3e3', fg: '#8a5300' } },
  { category: 'OBSERVATION', key: '3', colors: { border: '#1e3a5f', bg: '#eef3f9', fg: '#1e3a5f' } },
]

export function AnnotationCapture() {
  const {
    annotationPopoverOpen,
    annotationNote,
    annotationCategory,
    annotationAnchor,
    setAnnotationNote,
    setAnnotationCategory,
    saveAnnotation,
    closeAnnotation,
  } = useEvaluatorState()

  if (!annotationPopoverOpen) return null

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveAnnotation()
    if (e.key === 'Escape') closeAnnotation()
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        width: 430,
        bgcolor: '#fff',
        border: '1px solid #b9c7d8',
        borderRadius: '12px',
        boxShadow: '0 20px 60px rgba(12,20,32,.28)',
        p: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography sx={{ font: '800 10px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.12em', color: '#4a4f55' }}>
          NEW ANNOTATION
        </Typography>
        <Typography sx={{ font: '500 10.5px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
          ⚓ {annotationAnchor}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ font: '600 9.5px ui-monospace,Menlo,monospace', color: '#848482' }}>
          ENTER saves · ESC cancels
        </Typography>
      </Stack>

      <CobraTextField
        autoFocus
        placeholder="What did you observe?"
        value={annotationNote}
        onChange={e => setAnnotationNote(e.target.value)}
        onKeyDown={handleKeyDown}
        fullWidth
        size="small"
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
            font: '500 13px ui-sans-serif,system-ui,sans-serif',
          },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#1e3a5f', borderWidth: '1.5px' },
        }}
      />

      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
        {CATEGORIES.map(({ category, key, colors }) => {
          const selected = annotationCategory === category
          return (
            <Chip
              key={category}
              label={`${key} ${category}`}
              size="small"
              clickable
              onClick={() => setAnnotationCategory(category)}
              sx={{
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: '.06em',
                borderRadius: '999px',
                border: `1px solid ${selected ? colors.border : '#c4c4c4'}`,
                bgcolor: selected ? colors.bg : 'transparent',
                color: selected ? colors.fg : '#848482',
              }}
            />
          )
        })}
        <Box sx={{ flex: 1 }} />
        <Button onClick={closeAnnotation} sx={{ fontWeight: 600, fontSize: 11.5, color: '#4a4f55' }}>
          Cancel
        </Button>
        <Button
          onClick={saveAnnotation}
          sx={{ fontWeight: 700, fontSize: 11.5, color: '#fff', bgcolor: '#1e3a5f', borderRadius: '999px', px: 2, '&:hover': { bgcolor: '#2f5580' } }}
        >
          Save ⏎
        </Button>
      </Stack>
    </Box>
  )
}
