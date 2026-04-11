import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  EventSourceType,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';

import type { ActionItem, AppViewModel } from './types';

const IDS = {
  line1: 1,
  line2: 2,
  line3: 3,
  actions: 4,
} as const;

const NAMES = {
  line1: 'line1',
  line2: 'line2',
  line3: 'line3',
  actions: 'actions',
} as const;

const TITLE_WINDOW = 24;
const SUBTITLE_WINDOW = 26;
const TEXT_CONTAINER_WIDTH = 520;
const MARQUEE_GAP = '     ';
const MARQUEE_STEP_MS = 700;

function labelForGlasses(action: ActionItem): string {
  switch (action.id) {
    case 'toggle_play_pause':
      return 'Play/Pause';
    case 'skip_previous':
      return 'Prev';
    case 'skip_next':
      return 'Next';
    case 'seek_back_10':
      return '-10s';
    case 'seek_forward_10':
      return '+10s';
    case 'volume_down':
      return 'Vol -';
    case 'volume_up':
      return 'Vol +';
    case 'refresh':
      return 'Refresh';
    default:
      return action.label;
  }
}

function summarizeGlassesActions(actions: ActionItem[]): string {
  return actions.map((action) => `${action.id}:${action.disabled ? '0' : '1'}`).join('|');
}

function selectGlassesActions(actions: ActionItem[]): ActionItem[] {
  const preferredOrder: ActionItem['id'][] = [
    'toggle_play_pause',
    'skip_previous',
    'skip_next',
  ];

  return preferredOrder
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is ActionItem => Boolean(action));
}

function textContainer(
  containerID: number,
  containerName: string,
  yPosition: number,
  height: number,
  content: string,
): TextContainerProperty {
  return new TextContainerProperty({
    containerID,
    containerName,
    xPosition: 0,
    yPosition,
    width: TEXT_CONTAINER_WIDTH,
    height,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 2,
    content,
    isEventCapture: 0,
  });
}

function listContainer(items: string[]): ListContainerProperty {
  return new ListContainerProperty({
    containerID: IDS.actions,
    containerName: NAMES.actions,
    xPosition: 0,
    yPosition: 92,
    width: 576,
    height: 168,
    paddingLength: 0,
    borderWidth: 0,
    borderRadius: 0,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  });
}

function marqueeText(value: string, windowSize: number, nowMs: number): string {
  if (!value) {
    return '';
  }

  if (value.length <= windowSize) {
    return value;
  }

  const padded = `${value}${MARQUEE_GAP}`;
  const cycleLength = padded.length;
  const offset = Math.floor(nowMs / MARQUEE_STEP_MS) % cycleLength;
  const doubled = `${padded}${padded}`;
  return doubled.slice(offset, offset + windowSize);
}

function buildStartPage(actions: ActionItem[]): CreateStartUpPageContainer {
  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    textObject: [
      textContainer(IDS.line1, NAMES.line1, 0, 34, 'Connecting...'),
      textContainer(IDS.line2, NAMES.line2, 34, 28, ''),
      textContainer(IDS.line3, NAMES.line3, 62, 28, '00:00 / 00:00'),
    ],
    listObject: [listContainer(actions.map(labelForGlasses))],
  });
}

function buildRebuildPage(actions: ActionItem[]): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 4,
    textObject: [
      textContainer(IDS.line1, NAMES.line1, 0, 34, ''),
      textContainer(IDS.line2, NAMES.line2, 34, 28, ''),
      textContainer(IDS.line3, NAMES.line3, 62, 28, ''),
    ],
    listObject: [listContainer(actions.map(labelForGlasses))],
  });
}

async function upgradeText(
  bridge: EvenAppBridge,
  containerID: number,
  containerName: string,
  content: string,
): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID,
      containerName,
      content,
    }),
  );
}

export class GlassesUi {
  private bridge: EvenAppBridge | null = null;
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private actionSignature = '';
  private selectedIndex = 0;
  private displayedActions: ActionItem[] = [];

  async connect(
    onAction: (action: ActionItem) => void,
    onDebug?: (message: string) => void,
  ): Promise<boolean> {
    try {
      this.bridge = await waitForEvenAppBridge();
      this.unsubscribe = this.bridge.onEvenHubEvent((event) => {
        const listEvent = event.listEvent;
        if (listEvent && listEvent.containerID === IDS.actions) {
          onDebug?.(
            `list type=${String(listEvent.eventType)} rawIndex=${String(listEvent.currentSelectItemIndex)} selected=${String(this.selectedIndex)}`,
          );
          const rawIndex = listEvent.currentSelectItemIndex;

          if (typeof rawIndex === 'number') {
            this.selectedIndex = rawIndex;
          } else if (listEvent.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
            this.selectedIndex = Math.max(0, this.selectedIndex - 1);
          } else if (listEvent.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
            this.selectedIndex = Math.min(
              this.displayedActions.length - 1,
              this.selectedIndex + 1,
            );
          }

          const isClickByType = listEvent.eventType === OsEventTypeList.CLICK_EVENT;
          const isTapWithoutType =
            listEvent.eventType === undefined && typeof rawIndex === 'number';
          const isTopTapFallback = listEvent.eventType === undefined && rawIndex === undefined;

          if (isClickByType || isTapWithoutType) {
            const action = this.displayedActions[this.selectedIndex];
            if (action) {
              onAction(action);
            }
            return;
          }

          if (isTopTapFallback) {
            this.selectedIndex = 0;
            const action = this.displayedActions[0];
            if (action) {
              onAction(action);
            }
            return;
          }
        }

        const sysEvent = event.sysEvent;
        if (!sysEvent) {
          return;
        }

        onDebug?.(
          `sys type=${String(sysEvent.eventType)} source=${String(sysEvent.eventSource)}`,
        );

        const isInputSource =
          sysEvent.eventSource === EventSourceType.TOUCH_EVENT_FROM_RING ||
          sysEvent.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
          sysEvent.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R;
        const isClickLike =
          sysEvent.eventType === OsEventTypeList.CLICK_EVENT ||
          sysEvent.eventType === undefined;

        if (isClickLike && isInputSource) {
          const action = this.displayedActions[this.selectedIndex];
          if (action) {
            onAction(action);
          }
        }
      });
      return true;
    } catch {
      this.bridge = null;
      return false;
    }
  }

  async sync(viewModel: AppViewModel): Promise<void> {
    if (!this.bridge) {
      return;
    }

    this.displayedActions = selectGlassesActions(viewModel.actions);
    const nextSignature = summarizeGlassesActions(this.displayedActions);
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.displayedActions.length - 1));
    const nowMs = Date.now();
    const title = marqueeText(viewModel.title, TITLE_WINDOW, nowMs);
    const subtitle = marqueeText(viewModel.subtitle, SUBTITLE_WINDOW, nowMs);

    if (!this.initialized) {
      await this.bridge.createStartUpPageContainer(buildStartPage(this.displayedActions));
      this.initialized = true;
      this.actionSignature = nextSignature;
    } else if (nextSignature !== this.actionSignature) {
      await this.bridge.rebuildPageContainer(buildRebuildPage(this.displayedActions));
      this.actionSignature = nextSignature;
    }

    await Promise.all([
      upgradeText(this.bridge, IDS.line1, NAMES.line1, title),
      upgradeText(this.bridge, IDS.line2, NAMES.line2, subtitle),
      upgradeText(this.bridge, IDS.line3, NAMES.line3, viewModel.progress),
    ]);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
