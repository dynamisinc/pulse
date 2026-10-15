/**
 * features/social/components/media/ExerciseBands.default.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06: the SHIPPED path, nothing mocked. Under the real shell providers
 * (React Query + the exercise scope, `renderWithMediaProviders`) the chrome-config mock
 * resolves with `watermark: true` (DF-3: the mock defaults to marking), so every media
 * surface draws the EXERCISE bands out of the box.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExerciseBands } from './ExerciseBands'
import { renderWithMediaProviders } from './mediaTestUtils'

describe('ExerciseBands (default mock chrome config, shipped path)', () => {
  it('draws the top and bottom bands by default', async () => {
    renderWithMediaProviders(<ExerciseBands />)

    expect(await screen.findByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    expect(screen.getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
  })
})
