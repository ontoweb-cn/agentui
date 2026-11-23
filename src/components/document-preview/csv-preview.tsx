import message from '@/components/ui/message';
import { Spin } from '@/components/ui/spin';
import { useVirtualizer } from '@tanstack/react-virtual';
import request from '@/utils/request';
import classNames from 'classnames';
import Papa from 'papaparse';
import React, { useEffect, useRef, useState } from 'react';

interface CSVData {
  rows: string[][];
  headers: string[];
}

interface FileViewerProps {
  className?: string;
  url: string;
}

const ROW_HEIGHT = 52;

const CSVFileViewer: React.FC<FileViewerProps> = ({ url }) => {
  const [data, setData] = useState<CSVData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const parseCSV = (csvText: string): CSVData => {
    const result = Papa.parse<string[]>(csvText, {
      header: false,
      skipEmptyLines: false,
    });

    const rows = result.data as string[][];
    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1);

    return { headers, rows: dataRows };
  };

  useEffect(() => {
    const loadCSV = async () => {
      try {
        const res = await request(url, {
          method: 'GET',
          responseType: 'blob',
          onError: () => {
            message.error('file load failed');
            setIsLoading(false);
          },
        });

        const reader = new FileReader();
        reader.readAsText(res.data);
        reader.onload = () => {
          setData(parseCSV(reader.result as string));
        };
      } catch (error) {
        message.error('CSV file parse failed');
        console.error('Error loading CSV file:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadCSV();

    return () => {
      setData(null);
    };
  }, [url]);

  const rowCount = data?.rows.length ?? 0;
  const colCount = data?.headers.length ?? 1;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div
      ref={containerRef}
      className={classNames(
        'relative w-full h-full p-4 bg-background-paper border border-border-normal rounded-md',
        'overflow-auto max-h-[80vh] p-2',
      )}
    >
      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spin />
        </div>
      ) : data ? (
        <table className="min-w-full divide-y divide-border-normal">
          <thead className="bg-background-header-bar sticky top-0 z-[1]">
            <tr>
              {data.headers.map((header, index) => (
                <th
                  key={`header-${index}`}
                  className="px-6 py-3 text-left text-sm font-medium text-text-primary"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-background-paper divide-y divide-border-normal">
            {paddingTop > 0 ? (
              <tr aria-hidden>
                <td
                  colSpan={colCount}
                  style={{ height: paddingTop, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const row = data.rows[virtualRow.index];
              return (
                <tr key={`row-${virtualRow.index}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`cell-${virtualRow.index}-${cellIndex}`}
                      className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary"
                    >
                      {cell || '-'}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 ? (
              <tr aria-hidden>
                <td
                  colSpan={colCount}
                  style={{ height: paddingBottom, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};

export default CSVFileViewer;
