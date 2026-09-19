import React from 'react';
import { formatDateDefault } from '../../utils/date';

export interface UidCardProps {
  uidCode: string;
  qrDataUrl: string;
  issuedAt: string;
  employee: {
    employeeId: string;
    name: string;
    department: string;
    postTitle: string;
    gradePayLevel: string;
    employmentTypeCode: string;
    contactPhone?: string;
  };
  onPrint?: () => void;
}

export const UidCard: React.FC<UidCardProps> = ({
  uidCode,
  qrDataUrl,
  issuedAt,
  employee,
  onPrint,
}) => {
  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Printable Card Container */}
      <div
        id="printable-uid-card"
        className="w-full max-w-md bg-white rounded-xl shadow-md border-2 border-esic-primary/20 overflow-hidden text-gray-900 font-sans print:shadow-none print:border print:max-w-none print:w-full print:m-0"
      >
        {/* Card Header */}
        <div className="bg-esic-primary px-5 py-3 text-white flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">ESIC HOSPITAL SYSTEM</h2>
            <p className="text-xs text-blue-100 font-medium">Digital Identity Card</p>
          </div>
          <div className="bg-white/10 px-2.5 py-1 rounded text-xs font-mono font-semibold tracking-wide">
            {employee.employmentTypeCode}
          </div>
        </div>

        {/* Card Body */}
        <div className="p-5 flex items-start space-x-4">
          {/* QR Code Section */}
          <div className="flex flex-col items-center space-y-1.5 flex-shrink-0">
            <img
              src={qrDataUrl}
              alt={`QR Code for ${uidCode}`}
              className="w-28 h-28 rounded border border-gray-200 p-1 bg-white"
            />
            <span className="text-[10px] text-gray-400 font-mono">SCANNABLE</span>
          </div>

          {/* Details Section */}
          <div className="flex-grow space-y-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Hospital UID
              </span>
              <div className="text-lg font-bold font-mono text-esic-primary tracking-wide">
                {uidCode}
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Patient Name
              </span>
              <div className="text-sm font-semibold text-gray-800 leading-snug">
                {employee.name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-gray-100">
              <div>
                <span className="text-[10px] text-gray-400 block">Employee ID</span>
                <span className="font-mono font-medium text-gray-700">{employee.employeeId}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Department</span>
                <span className="font-medium text-gray-700 truncate block">
                  {employee.department}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Post</span>
                <span className="font-medium text-gray-700">{employee.postTitle}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Grade</span>
                <span className="font-medium text-gray-700">{employee.gradePayLevel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Footer */}
        <div className="bg-gray-50 px-5 py-2 text-[10px] text-gray-500 border-t border-gray-100 flex justify-between items-center">
          <span>Issued: {formatDateDefault(issuedAt)}</span>
          <span>ESIC Labour Dept Integration</span>
        </div>
      </div>

      {/* Action Button */}
      {onPrint && (
        <button
          onClick={onPrint}
          className="inline-flex items-center px-4 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-medium shadow-sm transition-colors print:hidden"
        >
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            ></path>
          </svg>
          Print UID Card
        </button>
      )}
    </div>
  );
};
