/**
 * features/orgDirectory/OrgDirectoryRoute.tsx
 * ---------------------------------------------------------------------------
 * The `/staff/people` route element (story 19, #574): the staff shell around the directory page,
 * composed exactly like `ExerciseManagementRoute` (no ExerciseContextProvider here, it is hoisted).
 * STAFF world (COBRA via StaffShellFrame).
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { OrgDirectoryPage } from './pages/OrgDirectoryPage'

export const OrgDirectoryRoute = () => (
  <ToolstripProvider>
    <StaffShellFrame header={<StaffHeader surfaceName="People" />} toolstrip={<Toolstrip />}>
      <OrgDirectoryPage />
    </StaffShellFrame>
  </ToolstripProvider>
)
