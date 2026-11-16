import React, { useState, useEffect } from 'react';
import { useSberCastStore } from '../sbercastStore';
import { type SberDevice } from '../sbercastApi';
import { SberSpeakerIcon } from './SberSpeakerIcon';

interface SberCastMenuProps {
  onClose: () => void;
  placement?: 'top' | 'bottom';
}

export const SberCastMenu: React.FC<SberCastMenuProps> = ({ onClose, placement = 'top' }) => {
  const {
    isConnected,
    isConnecting,
    isPairing,
    pairingHost,
    activeDevice,
    devices,
    isScanning,
    scanDevices,
    connectDevice,
    disconnect,
    pairDevice,
    removeDevice,
    addManualDevice,
  } = useSberCastStore();

  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('20000');
  const [showManualInput, setShowManualInput] = useState(false);
  const [addingManual, setAddingManual] = useState(false);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIp.trim()) return;
    setAddingManual(true);
    try {
      const port = parseInt(manualPort, 10) || 20000;
      await addManualDevice(manualIp.trim(), port);
      setManualIp('');
      setShowManualInput(false);
    } catch {
      // toast already shown in store
    } finally {
      setAddingManual(false);
    }
  };

  const handleDeviceClick = (device: SberDevice) => {
    if (isConnected && activeDevice?.host === device.host) {
      // Already active, do nothing or disconnect
      return;
    }
    if (device.is_paired) {
      connectDevice(device);
    } else {
      pairDevice(device.host, device.port, device.name);
    }
  };

  // Filter out the active device from the available devices list so it's not duplicated
  const availableDevices = devices.filter(
    (d) => !isConnected || activeDevice?.host !== d.host
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: placement === 'bottom' ? 'calc(100% + 14px)' : 'auto',
        bottom: placement === 'top' ? 'calc(100% + 14px)' : 'auto',
        right: '-10px',
        width: '320px',
        maxHeight: '520px',
        background: '#202028',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75), 0 4px 16px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(20px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: placement === 'bottom'
          ? 'sbercast-popover-enter-down 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
          : 'sbercast-popover-enter 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Triangle caret pointing directly at the button */}
      <div
        style={{
          position: 'absolute',
          top: placement === 'bottom' ? '-7px' : 'auto',
          bottom: placement === 'top' ? '-7px' : 'auto',
          right: '18px',
          width: '14px',
          height: '14px',
          background: '#202028',
          borderRight: placement === 'top' ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
          borderBottom: placement === 'top' ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
          borderLeft: placement === 'bottom' ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
          borderTop: placement === 'bottom' ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
          transform: 'rotate(45deg)',
          zIndex: -1,
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: '16px 18px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: '#FFFFFF',
            letterSpacing: '-0.2px',
          }}
        >
          Подключение к устройству
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => scanDevices()}
            disabled={isScanning}
            title="Обновить список устройств"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              color: 'rgba(255, 255, 255, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'all 0.15s ease',
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                animation: isScanning ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px',
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Currently Playing Device ("Сейчас играет" / Listening on) */}
      <div style={{ padding: '0 12px 10px' }}>
        <div
          style={{
            background: 'rgba(33, 192, 99, 0.1)',
            border: '1px solid rgba(33, 192, 99, 0.25)',
            borderRadius: '12px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(33, 192, 99, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isConnected && activeDevice ? (
              <SberSpeakerIcon device={activeDevice} size={20} color="#21c063" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#21c063" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#21c063',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Сейчас играет
            </div>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#21c063',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                marginTop: '1px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#21c063" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              <span>{isConnected && activeDevice ? activeDevice.name : 'Этот компьютер'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '0 12px 6px' }} />

      {/* Available Devices Section */}
      <div style={{ padding: '0 8px 4px', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
        <div
          style={{
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 700,
            color: 'rgba(255, 255, 255, 0.45)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
          }}
        >
          Выберите устройство
        </div>

        {/* If SberCast is connected, show "This Computer" as a selectable destination to return playback */}
        {isConnected && (
          <div
            onClick={() => disconnect()}
            style={{
              padding: '8px 10px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>
                Этот компьютер
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                Локальный динамик
              </div>
            </div>
          </div>
        )}

        {/* List of Sber Devices */}
        {availableDevices.map((device) => {
          const isThisPairing = isPairing && pairingHost === device.host;
          const isThisConnecting = isConnecting && activeDevice?.host === device.host;

          return (
            <div
              key={device.id || device.host}
              onClick={() => handleDeviceClick(device)}
              style={{
                padding: '8px 10px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                position: 'relative',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isThisConnecting ? '#21c063' : 'rgba(255, 255, 255, 0.85)',
                  flexShrink: 0,
                }}
              >
                <SberSpeakerIcon
                  device={device}
                  size={22}
                  color={isThisConnecting ? '#21c063' : 'rgba(255, 255, 255, 0.85)'}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: isThisConnecting ? '#21c063' : '#FFFFFF',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {device.name}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: isThisPairing
                      ? '#f59e0b'
                      : isThisConnecting
                      ? '#21c063'
                      : 'rgba(255, 255, 255, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {isThisPairing ? (
                    <span style={{ fontWeight: 600 }}>Нажмите кнопку + на колонке</span>
                  ) : isThisConnecting ? (
                    <span>Подключение...</span>
                  ) : device.is_paired ? (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      <span>SberCast</span>
                    </>
                  ) : (
                    <span>Не сопряжено • Нажмите для связи</span>
                  )}
                </div>
              </div>

              {/* Action button (forget device if paired) */}
              {device.is_paired && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => removeDevice(device.id)}
                    title="Забыть устройство"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.35)',
                      padding: '4px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {availableDevices.length === 0 && !isConnected && (
          <div
            style={{
              padding: '16px 12px',
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.45)',
              fontSize: '12px',
            }}
          >
            {isScanning ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    border: '2px solid #21c063',
                    borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span>Поиск колонок в сети...</span>
              </div>
            ) : (
              <div>
                <div>Колонки Sber не найдены</div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: 'rgba(255, 255, 255, 0.35)' }}>
                  Убедитесь, что колонка и ПК в одной Wi-Fi сети
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: Add by IP toggle */}
      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(0, 0, 0, 0.15)',
          padding: '8px 12px',
        }}
      >
        {!showManualInput ? (
          <button
            type="button"
            onClick={() => setShowManualInput(true)}
            style={{
              background: 'transparent',
              border: 'none',
              width: '100%',
              padding: '4px 6px',
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#FFFFFF')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.55)')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Добавить по IP-адресу</span>
          </button>
        ) : (
          <form onSubmit={handleAddManual} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="192.168.1.50"
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              autoFocus
              style={{
                flex: 1,
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '5px 8px',
                fontSize: '12px',
                color: '#FFFFFF',
                outline: 'none',
              }}
            />
            <input
              type="text"
              placeholder="20000"
              value={manualPort}
              onChange={(e) => setManualPort(e.target.value)}
              style={{
                width: '56px',
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '5px 6px',
                fontSize: '12px',
                color: '#FFFFFF',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={addingManual || !manualIp.trim()}
              style={{
                background: '#21c063',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#000000',
                cursor: addingManual || !manualIp.trim() ? 'not-allowed' : 'pointer',
                opacity: addingManual || !manualIp.trim() ? 0.6 : 1,
              }}
            >
              {addingManual ? '...' : 'Найти'}
            </button>
            <button
              type="button"
              onClick={() => setShowManualInput(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.5)',
                padding: '4px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
