import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const KEY = 'flowline:store';

describe('Flowline', () => {
  it('projects the demo figures and reports the low point', () => {
    window.location.hash = '/forecast';
    render(<App />);
    expect(screen.getByTestId('kpis')).toHaveTextContent('Lowest point');
    expect(screen.getByRole('img', { name: /Projected balance over 90 days/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Projected transactions/ })).toBeInTheDocument();
  });

  it('reads days from the chart with the keyboard', () => {
    window.location.hash = '/forecast';
    render(<App />);
    const chart = screen.getByRole('img', { name: /Projected balance over 90 days/ });
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('$1,840.00');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Groceries −$110.00');
  });

  it('changes the balance and shows an overdraft warning', async () => {
    window.location.hash = '/forecast';
    const user = userEvent.setup();
    render(<App />);
    const bal = screen.getByLabelText('Balance (USD)');
    await user.clear(bal);
    await user.type(bal, '-200');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByText(/Projected to go overdrawn on/)).toBeInTheDocument();
    await user.clear(bal);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByText(/Enter your current balance/)).toBeInTheDocument();
  });

  it('switching an item off changes the end balance', async () => {
    window.location.hash = '/forecast';
    const user = userEvent.setup();
    render(<App />);
    const before = screen.getByTestId('kpis').textContent;
    await user.click(screen.getByRole('checkbox', { name: 'Rent' }));
    expect(screen.getByTestId('kpis').textContent).not.toBe(before);
  });

  it('adds a fortnightly item with validation', async () => {
    localStorage.setItem(KEY, JSON.stringify({ settings: { balance: 100, asOf: '2026-01-01', horizon: 30, buffer: 0 }, items: [] }));
    window.location.hash = '/items';
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(screen.getByText('No items yet')).toBeInTheDocument();
    unmount();
    window.location.hash = '/item/new';
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(screen.getByText('Name the item.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.type(screen.getByLabelText('Name'), 'Pay');
    await user.type(screen.getByLabelText('Amount (USD)'), '1000');
    await user.selectOptions(screen.getByLabelText('How often'), 'weekly');
    await user.clear(screen.getByLabelText(/Every \(weeks\)/));
    await user.type(screen.getByLabelText(/Every \(weeks\)/), '2');
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByRole('link', { name: 'Pay' })).toBeInTheDocument();
    expect(screen.getByText('Every 2 weeks')).toBeInTheDocument();
  });
});
