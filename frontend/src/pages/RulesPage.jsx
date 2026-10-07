import { useState } from 'react';
import { Link } from 'react-router';
import { deleteRule, listRules, toQuery } from '../api/endpoints.js';
import { useApiData } from '../hooks/useApiData.js';
import { categoryName, useCategories } from '../hooks/useCategories.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorAlert, asApiError } from '../components/ErrorAlert.jsx';
import { Spinner } from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

// The corrections the user asked us to remember ("always put this merchant
// in …"). Deleting one stops it applying to future uploads; transactions keep
// the category they have now (backend T76).
export function RulesPage() {
  const { data, error, loading, reload } = useApiData(() => listRules().then((r) => r.rules), 'rules');
  const categories = useCategories();
  const toast = useToast();
  const [deleting, setDeleting] = useState(null);

  const remove = async (rule) => {
    if (!window.confirm(`Stop putting ${rule.merchantKey} in ${categoryName(categories, rule.category)}?\nExisting transactions keep their current category.`)) return;
    setDeleting(rule.id);
    try {
      await deleteRule(rule.id);
      toast('Rule removed.');
      reload();
    } catch (err) {
      toast(asApiError(err).message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Your rules</h1>
      </div>
      <p className="secondary" style={{ margin: 0 }}>
        When you change a transaction's category and choose "always", it's remembered here and used for every future upload.
      </p>
      <ErrorAlert error={error} />
      {loading && <Spinner />}
      {data && (
        <section className="card">
          {data.length === 0 ? (
            <div className="empty">
              <p>No rules yet. Change a category on the <Link to="/transactions">Transactions</Link> page to create one.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Merchant</th><th>Always put in</th><th>Last changed</th><th /></tr></thead>
                <tbody>
                  {data.map((rule) => (
                    <tr key={rule.id}>
                      <td className="description"><Link to={`/transactions?${toQuery({ merchant: rule.merchantKey })}`}>{rule.merchantKey}</Link></td>
                      <td>{categoryName(categories, rule.category)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(rule.updatedAt)}</td>
                      <td className="num">
                        <button type="button" className="danger" disabled={deleting === rule.id} onClick={() => remove(rule)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
