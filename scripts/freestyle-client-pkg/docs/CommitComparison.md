# CommitComparison

Response containing the comparison between two commits

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | [**ComparisonStatus**](ComparisonStatus.md) | Status of the comparison | 
**ahead_by** | **int** | Number of commits the head is ahead of base | 
**behind_by** | **int** | Number of commits the head is behind base | 
**total_commits** | **int** | Total number of commits in the comparison | 
**files** | [**List[DiffFile]**](DiffFile.md) | List of changed files | 

## Example

```python
from freestyle_client.models.commit_comparison import CommitComparison

# TODO update the JSON string below
json = "{}"
# create an instance of CommitComparison from a JSON string
commit_comparison_instance = CommitComparison.from_json(json)
# print the JSON string representation of the object
print(CommitComparison.to_json())

# convert the object into a dict
commit_comparison_dict = commit_comparison_instance.to_dict()
# create an instance of CommitComparison from a dict
commit_comparison_from_dict = CommitComparison.from_dict(commit_comparison_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


