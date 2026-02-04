import React, { useState } from "react";

const AutoSelect = ({ label, options, value, onChange }) => {
  const [show, setShow] = useState(false);

  const filtered = options.filter((item) =>
    item.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div style={{ position: "relative", marginBottom: "15px" }}>
      <label>{label}</label>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShow(true)}
        placeholder={`Select ${label}`}
        className="form-control"
      />

      {show && value && (
        <div className="dropdown">
          {filtered.map((item, index) => (
            <div
              key={index}
              className="dropdown-item"
              onClick={() => {
                onChange(item);
                setShow(false);
              }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AutoSelect;
