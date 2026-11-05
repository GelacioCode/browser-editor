import { useState } from 'react';
import { Film, Type, Captions } from 'lucide-react';
import { Tabs } from '../ui/ui.tsx';
import { MediaPanel } from './MediaPanel.tsx';
import { TextPanel } from './TextPanel.tsx';
import { CaptionsPanel } from './CaptionsPanel.tsx';

type Tab = 'media' | 'text' | 'captions';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'media', label: 'Media', icon: <Film size={13} /> },
          { value: 'text', label: 'Text', icon: <Type size={13} /> },
          { value: 'captions', label: 'Captions', icon: <Captions size={13} /> },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  );
}
