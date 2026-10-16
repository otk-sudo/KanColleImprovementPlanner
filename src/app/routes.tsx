import { Navigate, Route, Routes, useParams } from 'react-router';
import { CalendarPage, DayPage, PendingPage, SkipAttemptPage, SkipDayPage, WeekPage } from '../features/calendar/calendarPages';
import { GoalFormPage, GoalsPage, GoalStepsPage, UnplacedPage } from '../features/goals/goalsPages';
import { GuidePage, GuideStepsPage } from '../features/guide/guidePages';
import { CancelDraftPage, HistoryPage, RolloverDetailPage } from '../features/history/historyPages';
import { ImportConfirmPage, ImportErrorPage, ImportFilePage, ImportPastePage, ImportPreviewPage } from '../features/import/importPages';
import { EquipmentDetailPage, EquipmentInventoryPage, ItemsInventoryPage, ProtectionPage, ShipInventoryPage } from '../features/inventory/inventoryPages';
import { MaterialsPage } from '../features/materials/MaterialsPage';
import { WelcomePage } from '../features/onboarding/WelcomePage';
import { DraftConfirmPage, PastRecordPage, RecordPage } from '../features/record/recordPages';
import { RestorePage, SettingsPage } from '../features/settings/settingsPages';
import { useStore } from './store';

function Home() {
  const { data, projection } = useStore();
  const fresh = !projection.equipment.known && data.goals.length === 0 && data.attempts.length === 0;
  return <Navigate to={fresh ? '/welcome' : '/calendar'} replace />;
}

// 画面ID（docs/ui-reference）との対応はコメントで示す
/** 記録・訂正・再開の画面は、URL の対象（予定・記録・下書き）が変わったら入力を作り直す */
function KeyedRecordPage({ mode }: { mode: 'record' | 'correct' | 'resume' }) {
  const params = useParams();
  return <RecordPage key={`${mode}:${params.attemptId ?? params.eventId ?? params.draftId ?? ''}`} mode={mode} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<WelcomePage />} /> {/* S15 */}
      <Route path="/calendar" element={<CalendarPage />} /> {/* S01 */}
      <Route path="/calendar/week" element={<WeekPage />} /> {/* S02 */}
      <Route path="/calendar/day/:date" element={<DayPage />} /> {/* S18 */}
      <Route path="/calendar/day/:date/skip" element={<SkipDayPage />} /> {/* S25 */}
      <Route path="/attempts/:attemptId/skip" element={<SkipAttemptPage />} /> {/* S24 */}
      <Route path="/attempts/:attemptId/record" element={<KeyedRecordPage mode="record" />} /> {/* S13 */}
      <Route path="/attempts/:attemptId/draft" element={<DraftConfirmPage />} /> {/* S28 */}
      <Route path="/attempts/:attemptId/past" element={<PastRecordPage />} /> {/* S34 */}
      <Route path="/attempts/:attemptId/pending" element={<PendingPage />} /> {/* S30 */}
      <Route path="/goals" element={<GoalsPage />} /> {/* S03 */}
      <Route path="/goals/new" element={<GoalFormPage />} /> {/* S04 */}
      <Route path="/goals/:goalId/edit" element={<GoalFormPage />} /> {/* S04 */}
      <Route path="/goals/:goalId/steps" element={<GoalStepsPage />} /> {/* S19 */}
      <Route path="/unplaced" element={<UnplacedPage />} /> {/* S14 */}
      <Route path="/materials" element={<MaterialsPage />} /> {/* S05 */}
      <Route path="/inventory" element={<Navigate to="/inventory/equipment" replace />} />
      <Route path="/inventory/equipment" element={<EquipmentInventoryPage />} /> {/* S06 */}
      <Route path="/inventory/equipment/:equipmentId" element={<EquipmentDetailPage />} /> {/* S22 */}
      <Route path="/inventory/ships" element={<ShipInventoryPage />} /> {/* S16 */}
      <Route path="/inventory/items" element={<ItemsInventoryPage />} /> {/* S17 */}
      <Route path="/inventory/protection/:bucket" element={<ProtectionPage />} /> {/* S33 */}
      <Route path="/import" element={<ImportPastePage />} /> {/* S07 */}
      <Route path="/import/file" element={<ImportFilePage />} /> {/* S08 */}
      <Route path="/import/error" element={<ImportErrorPage />} /> {/* S20 */}
      <Route path="/import/preview" element={<ImportPreviewPage />} /> {/* S26 */}
      <Route path="/import/confirm" element={<ImportConfirmPage />} /> {/* S27 */}
      <Route path="/history" element={<HistoryPage />} /> {/* S09 */}
      <Route path="/history/rollover/:attemptId" element={<RolloverDetailPage />} /> {/* S29 */}
      <Route path="/history/events/:eventId/correct" element={<KeyedRecordPage mode="correct" />} /> {/* S13（訂正） */}
      <Route path="/history/drafts/:draftId/resume" element={<KeyedRecordPage mode="resume" />} /> {/* S13（再開） */}
      <Route path="/history/drafts/:draftId/cancel" element={<CancelDraftPage />} /> {/* S31 */}
      <Route path="/settings" element={<SettingsPage />} /> {/* S10 */}
      <Route path="/settings/restore" element={<RestorePage masterMode={false} />} /> {/* S21 */}
      <Route path="/settings/restore/master" element={<RestorePage masterMode />} /> {/* S32 */}
      <Route path="/guide" element={<Navigate to="/guide/browser" replace />} />
      <Route path="/guide/browser" element={<GuidePage env="browser" />} /> {/* S11 */}
      <Route path="/guide/74en" element={<GuidePage env="74en" />} /> {/* S12 */}
      <Route path="/guide/steps/:env/:step" element={<GuideStepsPage />} /> {/* S23 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
