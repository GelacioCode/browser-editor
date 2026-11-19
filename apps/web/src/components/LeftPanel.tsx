import { Film, Type, Captions, Bot } from 'lucide-react';
import { Tabs } from '../ui/ui.tsx';
import { useEditor, type LeftTab } from '../state/store.ts';
import { MediaPanel } from './MediaPanel.tsx';
import { TextPanel } from './TextPanel.tsx';
import { CaptionsPanel } from './CaptionsPanel.tsx';
import { AssistantPanel } from './AssistantPanel.tsx';

export function LeftPanel() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <div className="flex h-full flex-col">
      <Tabs<LeftTab>
        value={tab}
        onChange={(leftTab) => useEditor.setState({ leftTab })}
        tabs={[
          { value: 'media', label: 'Media', icon: <Film size={13} /> },
          { value: 'text', label: 'Text', icon: <Type size={13} /> },
          { value: 'captions', label: 'Captions', icon: <Captions size={13} /> },
          { value: 'ai', label: 'AI', icon: <Bot size={13} /> },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'captions' && <CaptionsPanel />}
        {tab === 'ai' && <AssistantPanel />}
      </div>
    </div>
  );
}
